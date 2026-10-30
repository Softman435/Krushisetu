const crypto = require('crypto');
const Razorpay = require('razorpay');
const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (
    !keyId ||
    !keySecret ||
    keyId.includes('xxxxxxxx') ||
    keySecret.toLowerCase().includes('your_razorpay')
  ) {
    throw new AppError(
      'Online payments are not configured. Add valid Razorpay test or live keys to backend/.env and restart the backend.',
      503
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function razorpayOrderError(error) {
  const statusCode = Number(error.statusCode || error.status_code);
  const providerCode = error.error?.code || error.code || 'UNKNOWN';

  console.error('[Razorpay] Order creation failed.', { statusCode, providerCode });

  if (statusCode === 401 || statusCode === 403) {
    return new AppError(
      'Razorpay rejected the configured API keys. Check that the key ID and secret belong to the same Razorpay test or live account.',
      502
    );
  }
  if (!Number.isFinite(statusCode)) {
    return new AppError('Could not connect to Razorpay. Check your internet connection and try again.', 503);
  }
  if (statusCode >= 500) {
    return new AppError('Razorpay is temporarily unavailable. Please try again shortly.', 502);
  }
  return new AppError(
    'Razorpay could not start this payment. Check the Razorpay account configuration and try again.',
    502
  );
}

/**
 * POST /api/payments/razorpay/create-order   (customer)
 * Body: { order_id }  -- our internal order id, created via /orders/checkout
 * Creates a Razorpay order for the exact amount and stores its id.
 */
const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { order_id } = req.body;
  const razorpay = getRazorpayClient();

  const [orders] = await pool.query(
    'SELECT * FROM orders WHERE id = :id AND customer_id = :customerId',
    { id: order_id, customerId: req.user.id }
  );
  if (!orders.length) throw new AppError('Order not found.', 404);
  const order = orders[0];

  if (order.payment_method !== 'RAZORPAY') throw new AppError('This order is not set up for online payment.', 400);
  if (order.payment_status === 'paid') throw new AppError('This order has already been paid for.', 400);

  const amountInPaise = Math.round(Number(order.total_amount) * 100);
  if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
    throw new AppError('This order has an invalid payment amount. Please contact support.', 400);
  }

  let razorpayOrder;
  try {
    razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.order_number,
      notes: { krushisetu_order_id: String(order.id) },
    });
  } catch (error) {
    throw razorpayOrderError(error);
  }

  const [paymentRows] = await pool.query(
    'SELECT id FROM payments WHERE order_id = :orderId AND method = "RAZORPAY"',
    { orderId: order.id }
  );
  if (!paymentRows.length) {
    throw new AppError('Payment record not found for this order. Please contact support.', 409);
  }

  await pool.query(
    `UPDATE payments
     SET razorpay_order_id = :rzpOrderId, status = 'created'
     WHERE order_id = :orderId AND method = 'RAZORPAY'`,
    { rzpOrderId: razorpayOrder.id, orderId: order.id }
  );

  return success(res, 200, 'Razorpay order created.', {
    razorpay_order_id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    key_id: process.env.RAZORPAY_KEY_ID,
  });
});

/**
 * POST /api/payments/razorpay/verify   (customer)
 * Body: { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Verifies the HMAC-SHA256 signature per Razorpay's documented scheme
 * BEFORE trusting the payment as successful. This is the critical
 * server-side authentication step — never trust the client's "success"
 * callback alone.
 */
const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const {
    order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature,
  } = req.body;
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keySecret || keySecret.toLowerCase().includes('your_razorpay')) {
    throw new AppError('Online payments are not configured. Contact support before retrying payment.', 503);
  }

  const [orders] = await pool.query(
    `SELECT o.*, p.razorpay_order_id AS stored_razorpay_order_id
     FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id AND p.method = 'RAZORPAY'
     WHERE o.id = :id AND o.customer_id = :customerId`,
    { id: order_id, customerId: req.user.id }
  );
  if (!orders.length) throw new AppError('Order not found.', 404);
  const order = orders[0];

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const signatureValid =
    order.payment_method === 'RAZORPAY' &&
    order.stored_razorpay_order_id === razorpay_order_id &&
    /^[a-f\d]{64}$/i.test(razorpay_signature) &&
    expectedSignature.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

  if (!signatureValid) {
    await pool.query(
      `UPDATE payments SET status = 'failed', failure_reason = 'Signature verification failed'
       WHERE order_id = :orderId`,
      { orderId: order.id }
    );
    throw new AppError('Payment verification failed. If money was deducted, it will be refunded.', 400);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE payments SET razorpay_payment_id = :paymentId, razorpay_signature = :signature, status = 'success'
       WHERE order_id = :orderId`,
      { paymentId: razorpay_payment_id, signature: razorpay_signature, orderId: order.id }
    );
    await conn.query(
      `UPDATE orders SET payment_status = 'paid', order_status = 'confirmed' WHERE id = :id`,
      { id: order.id }
    );
    await conn.query(
      `UPDATE order_items SET item_status = 'confirmed' WHERE order_id = :orderId AND item_status = 'pending'`,
      { orderId: order.id }
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return success(res, 200, 'Payment verified successfully.');
});

/**
 * POST /api/payments/razorpay/webhook
 * Optional server-to-server webhook for extra reliability (e.g. payment
 * captured/failed events even if the browser closes before /verify runs).
 * Validates the X-Razorpay-Signature header against the raw request body.
 */
const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    // Webhook secret not configured — reject rather than silently trusting.
    return res.status(501).json({ success: false, message: 'Webhook not configured.' });
  }

  // req.body is the raw Buffer here because this route is mounted with
  // express.raw() ahead of the global JSON parser (see app.js).
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || ''));
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const valid =
    expected.length === (signature || '').length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));

  if (!valid) return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });

  // Acknowledge receipt; detailed event handling can be extended here.
  return res.status(200).json({ success: true });
});

module.exports = { createRazorpayOrder, verifyRazorpayPayment, razorpayWebhook };
