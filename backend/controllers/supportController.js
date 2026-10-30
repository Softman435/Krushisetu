const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');

const raiseIssue = asyncHandler(async (req, res) => {
  const { order_id, subject, description } = req.body;
  const [result] = await pool.query(
    `INSERT INTO payment_issues (raised_by, order_id, subject, description)
     VALUES (:raisedBy, :orderId, :subject, :description)`,
    { raisedBy: req.user.id, orderId: order_id || null, subject, description }
  );
  return success(res, 201, 'Your issue has been submitted. Our team will get back to you shortly.', { id: result.insertId });
});

const getMyIssues = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM payment_issues WHERE raised_by = :userId ORDER BY created_at DESC',
    { userId: req.user.id }
  );
  return success(res, 200, 'Your issues fetched.', rows);
});

module.exports = { raiseIssue, getMyIssues };
