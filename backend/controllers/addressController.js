const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

const listAddresses = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM addresses WHERE user_id = :userId ORDER BY is_default DESC, created_at DESC',
    { userId: req.user.id }
  );
  return success(res, 200, 'Addresses fetched.', rows);
});

const addAddress = asyncHandler(async (req, res) => {
  const { full_name, phone, address_line, city, state, pincode, is_default } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (is_default) {
      await conn.query('UPDATE addresses SET is_default = 0 WHERE user_id = :userId', { userId: req.user.id });
    }
    const [result] = await conn.query(
      `INSERT INTO addresses (user_id, full_name, phone, address_line, city, state, pincode, is_default)
       VALUES (:userId, :full_name, :phone, :address_line, :city, :state, :pincode, :is_default)`,
      { userId: req.user.id, full_name, phone, address_line, city, state, pincode, is_default: is_default ? 1 : 0 }
    );
    await conn.commit();
    return success(res, 201, 'Address added.', { id: result.insertId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const updateAddress = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id FROM addresses WHERE id = :id AND user_id = :userId', {
    id: req.params.id, userId: req.user.id,
  });
  if (!rows.length) throw new AppError('Address not found.', 404);

  const { full_name, phone, address_line, city, state, pincode, is_default } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (is_default) {
      await conn.query('UPDATE addresses SET is_default = 0 WHERE user_id = :userId', { userId: req.user.id });
    }
    await conn.query(
      `UPDATE addresses SET full_name=:full_name, phone=:phone, address_line=:address_line,
        city=:city, state=:state, pincode=:pincode, is_default=:is_default
       WHERE id = :id`,
      { id: req.params.id, full_name, phone, address_line, city, state, pincode, is_default: is_default ? 1 : 0 }
    );
    await conn.commit();
    return success(res, 200, 'Address updated.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const deleteAddress = asyncHandler(async (req, res) => {
  const [result] = await pool.query('DELETE FROM addresses WHERE id = :id AND user_id = :userId', {
    id: req.params.id, userId: req.user.id,
  });
  if (!result.affectedRows) throw new AppError('Address not found.', 404);
  return success(res, 200, 'Address deleted.');
});

module.exports = { listAddresses, addAddress, updateAddress, deleteAddress };
