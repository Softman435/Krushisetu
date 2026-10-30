const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

const MIN_WITHDRAWAL_AMOUNT = 100;

const getMyWallet = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM wallets WHERE farmer_id = :farmerId', { farmerId: req.user.id });
  if (!rows.length) throw new AppError('Wallet not found.', 404);
  return success(res, 200, 'Wallet fetched.', rows[0]);
});

const getMyWalletTransactions = asyncHandler(async (req, res) => {
  const [wallet] = await pool.query('SELECT id FROM wallets WHERE farmer_id = :farmerId', { farmerId: req.user.id });
  if (!wallet.length) throw new AppError('Wallet not found.', 404);

  const [rows] = await pool.query(
    'SELECT * FROM wallet_transactions WHERE wallet_id = :walletId ORDER BY created_at DESC LIMIT 200',
    { walletId: wallet[0].id }
  );
  return success(res, 200, 'Wallet transactions fetched.', rows);
});

/**
 * POST /api/wallet/withdraw   (farmer)
 * Body: { amount, bank_account_number, bank_ifsc }
 * Deducts the requested amount from the wallet balance immediately
 * (held in "requested" state) and creates a withdrawal request for
 * admin processing. If rejected, the admin flow should credit it back.
 */
const requestWithdrawal = asyncHandler(async (req, res) => {
  const { amount, bank_account_number, bank_ifsc } = req.body;

  if (Number(amount) < MIN_WITHDRAWAL_AMOUNT) {
    throw new AppError(`Minimum withdrawal amount is ₹${MIN_WITHDRAWAL_AMOUNT}.`, 400);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [walletRows] = await conn.query(
      'SELECT * FROM wallets WHERE farmer_id = :farmerId FOR UPDATE',
      { farmerId: req.user.id }
    );
    if (!walletRows.length) throw new AppError('Wallet not found.', 404);
    const wallet = walletRows[0];

    if (Number(wallet.balance) < Number(amount)) {
      throw new AppError('Insufficient wallet balance.', 400);
    }

    const newBalance = Number(wallet.balance) - Number(amount);
    await conn.query('UPDATE wallets SET balance = :balance WHERE id = :id', {
      balance: newBalance.toFixed(2), id: wallet.id,
    });

    await conn.query(
      `INSERT INTO wallet_transactions (wallet_id, type, amount, description, balance_after)
       VALUES (:walletId, 'debit', :amount, 'Withdrawal request submitted', :balanceAfter)`,
      { walletId: wallet.id, amount, balanceAfter: newBalance.toFixed(2) }
    );

    const [result] = await conn.query(
      `INSERT INTO withdrawals (farmer_id, amount, bank_account_number, bank_ifsc, status)
       VALUES (:farmerId, :amount, :bankAccountNumber, :bankIfsc, 'requested')`,
      { farmerId: req.user.id, amount, bankAccountNumber: bank_account_number, bankIfsc: bank_ifsc }
    );

    await conn.commit();
    return success(res, 201, 'Withdrawal request submitted.', { id: result.insertId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const getMyWithdrawals = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM withdrawals WHERE farmer_id = :farmerId ORDER BY created_at DESC',
    { farmerId: req.user.id }
  );
  return success(res, 200, 'Withdrawal history fetched.', rows);
});

module.exports = { getMyWallet, getMyWalletTransactions, requestWithdrawal, getMyWithdrawals };
