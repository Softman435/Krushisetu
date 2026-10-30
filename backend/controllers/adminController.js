const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

// ---------------------------------------------------------------- USERS ----
const listFarmers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.created_at,
            fp.farm_name, fp.district, fp.state, fp.approved
     FROM users u JOIN farmer_profiles fp ON fp.user_id = u.id
     WHERE u.role = 'farmer' ORDER BY u.created_at DESC`
  );
  return success(res, 200, 'Farmers fetched.', rows);
});

const listCustomers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, is_active, created_at
     FROM users WHERE role = 'customer' ORDER BY created_at DESC`
  );
  return success(res, 200, 'Customers fetched.', rows);
});

const toggleUserActive = asyncHandler(async (req, res) => {
  const { is_active } = req.body;
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = :id', { id: req.params.id });
  if (!rows.length) throw new AppError('User not found.', 404);
  if (rows[0].role === 'admin') throw new AppError('Cannot deactivate an admin account.', 400);

  await pool.query('UPDATE users SET is_active = :isActive WHERE id = :id', {
    isActive: is_active ? 1 : 0, id: req.params.id,
  });
  return success(res, 200, `User ${is_active ? 'activated' : 'deactivated'}.`);
});

const approveFarmerProfile = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT user_id FROM farmer_profiles WHERE user_id = :id', { id: req.params.id });
  if (!rows.length) throw new AppError('Farmer profile not found.', 404);
  await pool.query('UPDATE farmer_profiles SET approved = 1 WHERE user_id = :id', { id: req.params.id });
  return success(res, 200, 'Farmer profile approved.');
});

// -------------------------------------------------------------- PRODUCTS ---
const listProductsForReview = asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, u.name AS farmer_name, u.email AS farmer_email
     FROM products p JOIN categories c ON c.id = p.category_id JOIN users u ON u.id = p.farmer_id
     WHERE p.status = :status ORDER BY p.created_at ASC`,
    { status }
  );
  return success(res, 200, 'Products fetched.', rows);
});

const approveProduct = asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    `UPDATE products SET status = 'approved', rejection_reason = NULL WHERE id = :id AND status = 'pending'`,
    { id: req.params.id }
  );
  if (!result.affectedRows) throw new AppError('Product not found or not pending review.', 404);
  return success(res, 200, 'Product approved and is now live in the marketplace.');
});

const rejectProduct = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const [result] = await pool.query(
    `UPDATE products SET status = 'rejected', rejection_reason = :reason WHERE id = :id AND status = 'pending'`,
    { id: req.params.id, reason }
  );
  if (!result.affectedRows) throw new AppError('Product not found or not pending review.', 404);
  return success(res, 200, 'Product rejected.');
});

const disableProduct = asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    `UPDATE products SET status = 'disabled' WHERE id = :id AND status = 'approved'`,
    { id: req.params.id }
  );
  if (!result.affectedRows) throw new AppError('Product not found or not currently approved.', 404);
  return success(res, 200, 'Product disabled and removed from the marketplace.');
});

// --------------------------------------------------------- DELIVERY FEES ---
const setDeliveryCharge = asyncHandler(async (req, res) => {
  const { category_id, base_charge, per_kg_charge, free_above_amount } = req.body;

  const [cat] = await pool.query('SELECT id FROM categories WHERE id = :id', { id: category_id });
  if (!cat.length) throw new AppError('Category not found.', 404);

  await pool.query(
    `INSERT INTO delivery_charges (category_id, base_charge, per_kg_charge, free_above_amount)
     VALUES (:category_id, :base_charge, :per_kg_charge, :free_above_amount)
     ON DUPLICATE KEY UPDATE base_charge = :base_charge, per_kg_charge = :per_kg_charge,
       free_above_amount = :free_above_amount`,
    { category_id, base_charge, per_kg_charge, free_above_amount: free_above_amount ?? null }
  );
  return success(res, 200, 'Delivery charge configuration saved.');
});

const listDeliveryCharges = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT dc.*, c.name AS category_name FROM delivery_charges dc
     JOIN categories c ON c.id = dc.category_id ORDER BY c.name`
  );
  return success(res, 200, 'Delivery charges fetched.', rows);
});

// ------------------------------------------------------------------ ORDERS -
const listAllOrders = asyncHandler(async (req, res) => {
  const { status, payment_status, page = 1, limit = 20 } = req.query;
  const where = [];
  const params = {};
  if (status) { where.push('o.order_status = :status'); params.status = status; }
  if (payment_status) { where.push('o.payment_status = :paymentStatus'); params.paymentStatus = payment_status; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Number(page) - 1) * Number(limit);

  const [rows] = await pool.query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email
     FROM orders o JOIN users u ON u.id = o.customer_id
     ${whereSql} ORDER BY o.created_at DESC LIMIT :limit OFFSET :offset`,
    { ...params, limit: Number(limit), offset }
  );
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM orders o ${whereSql}`, params);

  return success(res, 200, 'Orders fetched.', rows, { page: Number(page), limit: Number(limit), total: countRows[0].total });
});

// --------------------------------------------------------------- REFUNDS ---
const listRefunds = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, o.order_number, o.customer_id, u.name AS customer_name
     FROM refunds r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = o.customer_id
     ORDER BY r.created_at DESC`
  );
  return success(res, 200, 'Refunds fetched.', rows);
});

const updateRefundStatus = asyncHandler(async (req, res) => {
  const { status } = req.body; // processing | completed | rejected
  const [rows] = await pool.query('SELECT * FROM refunds WHERE id = :id', { id: req.params.id });
  if (!rows.length) throw new AppError('Refund not found.', 404);

  await pool.query('UPDATE refunds SET status = :status, processed_by = :adminId WHERE id = :id', {
    status, adminId: req.user.id, id: req.params.id,
  });

  if (status === 'completed') {
    await pool.query(`UPDATE orders SET payment_status = 'refunded' WHERE id = :orderId`, {
      orderId: rows[0].order_id,
    });
  }

  return success(res, 200, 'Refund status updated.');
});

// ---------------------------------------------------------- WALLETS ----
const listFarmerWallets = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT w.*, u.name AS farmer_name, u.email AS farmer_email
     FROM wallets w JOIN users u ON u.id = w.farmer_id ORDER BY w.balance DESC`
  );
  return success(res, 200, 'Farmer wallets fetched.', rows);
});

// ------------------------------------------------------------ WITHDRAWALS --
const listWithdrawals = asyncHandler(async (req, res) => {
  const status = req.query.status;
  const where = status ? 'WHERE w.status = :status' : '';
  const [rows] = await pool.query(
    `SELECT w.*, u.name AS farmer_name, u.email AS farmer_email
     FROM withdrawals w JOIN users u ON u.id = w.farmer_id
     ${where} ORDER BY w.created_at DESC`,
    status ? { status } : {}
  );
  return success(res, 200, 'Withdrawals fetched.', rows);
});

/**
 * PATCH /api/admin/withdrawals/:id
 * Body: { status: 'approved' | 'processed' | 'rejected', admin_remark }
 * If rejected, the previously debited amount is credited back to the wallet.
 */
const updateWithdrawalStatus = asyncHandler(async (req, res) => {
  const { status, admin_remark } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM withdrawals WHERE id = :id FOR UPDATE', { id: req.params.id });
    if (!rows.length) throw new AppError('Withdrawal request not found.', 404);
    const withdrawal = rows[0];

    if (withdrawal.status !== 'requested' && withdrawal.status !== 'approved') {
      throw new AppError(`Cannot update a withdrawal that is already ${withdrawal.status}.`, 400);
    }

    if (status === 'rejected') {
      const [walletRows] = await conn.query(
        'SELECT * FROM wallets WHERE farmer_id = :farmerId FOR UPDATE',
        { farmerId: withdrawal.farmer_id }
      );
      const wallet = walletRows[0];
      const newBalance = Number(wallet.balance) + Number(withdrawal.amount);
      await conn.query('UPDATE wallets SET balance = :balance WHERE id = :id', {
        balance: newBalance.toFixed(2), id: wallet.id,
      });
      await conn.query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, description, balance_after)
         VALUES (:walletId, 'credit', :amount, 'Withdrawal request rejected — amount refunded', :balanceAfter)`,
        { walletId: wallet.id, amount: withdrawal.amount, balanceAfter: newBalance.toFixed(2) }
      );
    }

    if (status === 'processed') {
      await conn.query(
        'UPDATE wallets SET total_withdrawn = total_withdrawn + :amount WHERE farmer_id = :farmerId',
        { amount: withdrawal.amount, farmerId: withdrawal.farmer_id }
      );
    }

    await conn.query(
      'UPDATE withdrawals SET status = :status, admin_remark = :remark, processed_by = :adminId WHERE id = :id',
      { status, remark: admin_remark || null, adminId: req.user.id, id: req.params.id }
    );

    await conn.commit();
    return success(res, 200, 'Withdrawal status updated.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ----------------------------------------------------------- PAYMENT ISSUES-
const listPaymentIssues = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pi.*, u.name AS raised_by_name, u.role AS raised_by_role, o.order_number
     FROM payment_issues pi JOIN users u ON u.id = pi.raised_by
     LEFT JOIN orders o ON o.id = pi.order_id
     ORDER BY pi.created_at DESC`
  );
  return success(res, 200, 'Payment issues fetched.', rows);
});

const resolvePaymentIssue = asyncHandler(async (req, res) => {
  const { status, admin_response } = req.body;
  const [result] = await pool.query(
    `UPDATE payment_issues SET status = :status, admin_response = :response, resolved_by = :adminId WHERE id = :id`,
    { status, response: admin_response || null, adminId: req.user.id, id: req.params.id }
  );
  if (!result.affectedRows) throw new AppError('Payment issue not found.', 404);
  return success(res, 200, 'Payment issue updated.');
});

// ---------------------------------------------------------------- REPORTS --
const getDashboardSummary = asyncHandler(async (req, res) => {
  const [[userCounts]] = await pool.query(
    `SELECT
       SUM(role='farmer') AS total_farmers,
       SUM(role='customer') AS total_customers
     FROM users`
  );
  const [[productCounts]] = await pool.query(
    `SELECT
       SUM(status='pending') AS pending_products,
       SUM(status='approved') AS approved_products,
       SUM(status='rejected') AS rejected_products
     FROM products`
  );
  const [[orderCounts]] = await pool.query(
    `SELECT
       COUNT(*) AS total_orders,
       SUM(order_status='placed') AS placed,
       SUM(order_status='delivered') AS delivered,
       SUM(order_status='cancelled') AS cancelled,
       SUM(total_amount) AS gross_sales
     FROM orders`
  );
  const [[revenue]] = await pool.query(
    `SELECT SUM(platform_fee) AS platform_revenue, SUM(farmer_earning) AS total_farmer_earnings
     FROM order_items WHERE item_status = 'delivered'`
  );
  const [[withdrawals]] = await pool.query(
    `SELECT SUM(amount) AS pending_withdrawals FROM withdrawals WHERE status IN ('requested','approved')`
  );

  return success(res, 200, 'Dashboard summary fetched.', {
    users: userCounts,
    products: productCounts,
    orders: orderCounts,
    revenue,
    withdrawals,
  });
});

module.exports = {
  listFarmers,
  listCustomers,
  toggleUserActive,
  approveFarmerProfile,
  listProductsForReview,
  approveProduct,
  rejectProduct,
  disableProduct,
  setDeliveryCharge,
  listDeliveryCharges,
  listAllOrders,
  listRefunds,
  updateRefundStatus,
  listFarmerWallets,
  listWithdrawals,
  updateWithdrawalStatus,
  listPaymentIssues,
  resolvePaymentIssue,
  getDashboardSummary,
};
