const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT) || 2;

function gradeColumns(grade) {
  const map = {
    A: { price: 'grade_a_price', qty: 'grade_a_quantity' },
    B: { price: 'grade_b_price', qty: 'grade_b_quantity' },
    C: { price: 'grade_c_price', qty: 'grade_c_quantity' },
  };
  return map[grade];
}

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KS-${ts}-${rand}`;
}

/**
 * Computes delivery charge for a set of {category_id, weight/qty} lines
 * using the admin-configured per-category rates. Falls back to 0 if a
 * category has no configured charge.
 */
async function computeDeliveryCharge(conn, lineItems) {
  let total = 0;
  const categoryTotals = {}; // category_id -> total quantity
  for (const item of lineItems) {
    categoryTotals[item.category_id] = (categoryTotals[item.category_id] || 0) + Number(item.quantity);
  }
  const categoryIds = Object.keys(categoryTotals);
  if (!categoryIds.length) return 0;

  const [rows] = await conn.query(
    `SELECT category_id, base_charge, per_kg_charge, free_above_amount
     FROM delivery_charges WHERE category_id IN (${categoryIds.map(() => '?').join(',')})`,
    categoryIds
  );
  const chargeMap = Object.fromEntries(rows.map((r) => [r.category_id, r]));

  for (const catId of categoryIds) {
    const charge = chargeMap[catId];
    if (!charge) continue;
    total += Number(charge.base_charge) + Number(charge.per_kg_charge) * categoryTotals[catId];
  }
  return total;
}

/**
 * POST /api/orders/checkout   (customer only)
 * Body: { address_id, payment_method: 'COD' | 'RAZORPAY' }
 * Converts the customer's cart into an order, locking stock and pricing
 * at the moment of purchase. Wrapped in a DB transaction with row locks
 * (FOR UPDATE) to prevent overselling under concurrent checkouts.
 */
const checkout = asyncHandler(async (req, res) => {
  const { address_id, payment_method } = req.body;

  const [addressRows] = await pool.query(
    'SELECT id FROM addresses WHERE id = :id AND user_id = :userId',
    { id: address_id, userId: req.user.id }
  );
  if (!addressRows.length) throw new AppError('Delivery address not found.', 404);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cartRows] = await conn.query(
      'SELECT * FROM cart_items WHERE customer_id = :customerId FOR UPDATE',
      { customerId: req.user.id }
    );
    if (!cartRows.length) throw new AppError('Your cart is empty.', 400);

    const orderLines = [];
    let subtotal = 0;

    for (const item of cartRows) {
      const [productRows] = await conn.query(
        'SELECT * FROM products WHERE id = :id AND status = "approved" AND is_available = 1 FOR UPDATE',
        { id: item.product_id }
      );
      if (!productRows.length) {
        throw new AppError(`One of the products in your cart is no longer available.`, 409);
      }
      const product = productRows[0];
      const { price: priceCol, qty: qtyCol } = gradeColumns(item.grade);
      const availableQty = Number(product[qtyCol]);
      const unitPrice = Number(product[priceCol]);

      if (product[priceCol] == null || availableQty < Number(item.quantity)) {
        throw new AppError(
          `Insufficient stock for "${product.name}" (Grade ${item.grade}). Only ${availableQty} ${product.unit} left.`,
          409
        );
      }

      const lineTotal = unitPrice * Number(item.quantity);
      subtotal += lineTotal;

      orderLines.push({
        product_id: product.id,
        farmer_id: product.farmer_id,
        category_id: product.category_id,
        grade: item.grade,
        unit_price: unitPrice,
        quantity: Number(item.quantity),
        line_total: lineTotal,
        qtyCol,
      });
    }

    const deliveryCharge = await computeDeliveryCharge(conn, orderLines);
    const totalAmount = subtotal + deliveryCharge;

    const orderNumber = generateOrderNumber();
    const [orderResult] = await conn.query(
      `INSERT INTO orders
        (order_number, customer_id, address_id, subtotal, delivery_charge, total_amount, payment_method, payment_status, order_status)
       VALUES
        (:orderNumber, :customerId, :addressId, :subtotal, :deliveryCharge, :totalAmount, :paymentMethod,
         :paymentStatus, 'placed')`,
      {
        orderNumber, customerId: req.user.id, addressId: address_id,
        subtotal: subtotal.toFixed(2), deliveryCharge: deliveryCharge.toFixed(2), totalAmount: totalAmount.toFixed(2),
        paymentMethod: payment_method,
        paymentStatus: payment_method === 'COD' ? 'pending' : 'pending',
      }
    );
    const orderId = orderResult.insertId;

    for (const line of orderLines) {
      const platformFee = Number((line.line_total * (PLATFORM_FEE_PERCENT / 100)).toFixed(2));
      const farmerEarning = Number((line.line_total - platformFee).toFixed(2));

      await conn.query(
        `INSERT INTO order_items
          (order_id, product_id, farmer_id, grade, unit_price, quantity, line_total, platform_fee, farmer_earning)
         VALUES (:orderId, :productId, :farmerId, :grade, :unitPrice, :quantity, :lineTotal, :platformFee, :farmerEarning)`,
        {
          orderId, productId: line.product_id, farmerId: line.farmer_id, grade: line.grade,
          unitPrice: line.unit_price, quantity: line.quantity, lineTotal: line.line_total.toFixed(2),
          platformFee, farmerEarning,
        }
      );

      // Deduct stock for the grade purchased.
      await conn.query(
        `UPDATE products SET ${line.qtyCol} = ${line.qtyCol} - :qty WHERE id = :id`,
        { qty: line.quantity, id: line.product_id }
      );
    }

    // Record payment intent row (COD: recorded as pending-until-delivery; Razorpay: created here, confirmed via webhook/verify endpoint)
    await conn.query(
      `INSERT INTO payments (order_id, amount, method, status)
       VALUES (:orderId, :amount, :method, :status)`,
      {
        orderId, amount: totalAmount.toFixed(2), method: payment_method,
        status: payment_method === 'COD' ? 'pending' : 'created',
      }
    );

    await conn.query('DELETE FROM cart_items WHERE customer_id = :customerId', { customerId: req.user.id });

    await conn.commit();

    return success(res, 201, 'Order placed successfully.', {
      order_id: orderId,
      order_number: orderNumber,
      subtotal: Number(subtotal.toFixed(2)),
      delivery_charge: Number(deliveryCharge.toFixed(2)),
      total_amount: Number(totalAmount.toFixed(2)),
      payment_method,
      requires_online_payment: payment_method === 'RAZORPAY',
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * Credits a farmer's wallet for a single delivered order item (idempotent).
 * Called once an order item's status transitions to 'delivered'.
 */
async function creditFarmerWallet(conn, orderItem) {
  if (orderItem.wallet_credited) return;

  const [walletRows] = await conn.query(
    'SELECT id, balance FROM wallets WHERE farmer_id = :farmerId FOR UPDATE',
    { farmerId: orderItem.farmer_id }
  );
  if (!walletRows.length) throw new AppError('Farmer wallet not found.', 500);
  const wallet = walletRows[0];

  const newBalance = Number(wallet.balance) + Number(orderItem.farmer_earning);

  await conn.query(
    'UPDATE wallets SET balance = :balance, total_earned = total_earned + :earning WHERE id = :id',
    { balance: newBalance.toFixed(2), earning: orderItem.farmer_earning, id: wallet.id }
  );
  await conn.query(
    `INSERT INTO wallet_transactions (wallet_id, order_item_id, type, amount, description, balance_after)
     VALUES (:walletId, :orderItemId, 'credit', :amount, :description, :balanceAfter)`,
    {
      walletId: wallet.id, orderItemId: orderItem.id, amount: orderItem.farmer_earning,
      description: `Earning from order item #${orderItem.id} (after ${PLATFORM_FEE_PERCENT}% platform fee)`,
      balanceAfter: newBalance.toFixed(2),
    }
  );
  await conn.query('UPDATE order_items SET wallet_credited = 1 WHERE id = :id', { id: orderItem.id });
}

/**
 * GET /api/orders/my   (customer)
 */
const getMyOrders = asyncHandler(async (req, res) => {
  const [orders] = await pool.query(
    'SELECT * FROM orders WHERE customer_id = :customerId ORDER BY created_at DESC',
    { customerId: req.user.id }
  );
  return success(res, 200, 'Orders fetched.', orders);
});

/**
 * GET /api/orders/:id   (customer, own order only; farmer/admin can also view)
 */
const getOrderById = asyncHandler(async (req, res) => {
  const [orders] = await pool.query('SELECT * FROM orders WHERE id = :id', { id: req.params.id });
  if (!orders.length) throw new AppError('Order not found.', 404);
  const order = orders[0];

  const isOwner = req.user.role === 'customer' && order.customer_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  const [items] = await pool.query(
    `SELECT oi.*, p.name AS product_name, p.unit
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = :orderId ${req.user.role === 'farmer' ? 'AND oi.farmer_id = :farmerId' : ''}`,
    { orderId: order.id, farmerId: req.user.id }
  );

  const isFarmerWithItems = req.user.role === 'farmer' && items.length > 0;
  if (!isOwner && !isAdmin && !isFarmerWithItems) {
    throw new AppError('You do not have access to this order.', 403);
  }

  return success(res, 200, 'Order fetched.', { ...order, items });
});

/**
 * GET /api/orders/farmer/mine   (farmer — order items belonging to them)
 */
const getFarmerOrderItems = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT oi.*, o.order_number, o.order_status, o.payment_status, o.created_at AS order_date,
            p.name AS product_name, p.unit
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE oi.farmer_id = :farmerId
     ORDER BY o.created_at DESC`,
    { farmerId: req.user.id }
  );
  return success(res, 200, 'Your order items fetched.', rows);
});

/**
 * PATCH /api/orders/items/:itemId/status   (farmer — update their line item status)
 * Allowed transitions: pending -> confirmed -> shipped -> delivered
 * On transition to 'delivered', credits the farmer's wallet.
 */
const updateOrderItemStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['confirmed', 'shipped', 'delivered'];
  if (!allowed.includes(status)) throw new AppError('Invalid status transition.', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM order_items WHERE id = :id AND farmer_id = :farmerId FOR UPDATE',
      { id: req.params.itemId, farmerId: req.user.id }
    );
    if (!rows.length) throw new AppError('Order item not found.', 404);
    const item = rows[0];

    if (item.item_status === 'cancelled' || item.item_status === 'returned') {
      throw new AppError(`Cannot update a ${item.item_status} item.`, 400);
    }

    await conn.query('UPDATE order_items SET item_status = :status WHERE id = :id', {
      status, id: item.id,
    });

    if (status === 'delivered') {
      await creditFarmerWallet(conn, item);
      // If Razorpay order and this was the last item, we still leave overall
      // order status/payment status management to a periodic sync or the
      // customer-facing order status endpoint below.
    }

    await conn.commit();
    return success(res, 200, 'Order item status updated.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * PATCH /api/orders/:id/cancel   (customer — cancel before shipment)
 */
const cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query(
      'SELECT * FROM orders WHERE id = :id AND customer_id = :customerId FOR UPDATE',
      { id: req.params.id, customerId: req.user.id }
    );
    if (!orders.length) throw new AppError('Order not found.', 404);
    const order = orders[0];

    if (!['placed', 'confirmed'].includes(order.order_status)) {
      throw new AppError('This order can no longer be cancelled.', 400);
    }

    const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = :orderId', { orderId: order.id });

    for (const item of items) {
      if (item.item_status === 'shipped' || item.item_status === 'delivered') {
        throw new AppError('Some items have already been shipped. Contact support to cancel.', 400);
      }
    }

    for (const item of items) {
      const { qty: qtyCol } = gradeColumns(item.grade);
      await conn.query(`UPDATE products SET ${qtyCol} = ${qtyCol} + :qty WHERE id = :id`, {
        qty: item.quantity, id: item.product_id,
      });
      await conn.query('UPDATE order_items SET item_status = "cancelled" WHERE id = :id', { id: item.id });
    }

    const newPaymentStatus = order.payment_status === 'paid' ? 'refunded' : order.payment_status;
    await conn.query(
      'UPDATE orders SET order_status = "cancelled", cancellation_reason = :reason, payment_status = :paymentStatus WHERE id = :id',
      { reason: reason || null, paymentStatus: newPaymentStatus, id: order.id }
    );

    if (order.payment_status === 'paid') {
      await conn.query(
        `INSERT INTO refunds (order_id, amount, reason, status)
         VALUES (:orderId, :amount, :reason, 'requested')`,
        { orderId: order.id, amount: order.total_amount, reason: reason || 'Order cancelled by customer' }
      );
    }

    await conn.commit();
    return success(res, 200, 'Order cancelled successfully.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = {
  checkout,
  getMyOrders,
  getOrderById,
  getFarmerOrderItems,
  updateOrderItemStatus,
  cancelOrder,
  creditFarmerWallet,
};
