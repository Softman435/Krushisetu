const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const {
  getMyWallet, getMyWalletTransactions, requestWithdrawal, getMyWithdrawals,
} = require('../controllers/walletController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

router.use(protect, authorize('farmer'));

router.get('/', getMyWallet);
router.get('/transactions', getMyWalletTransactions);
router.get('/withdrawals', getMyWithdrawals);

router.post(
  '/withdraw',
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0.'),
  body('bank_account_number').trim().notEmpty().isLength({ min: 6, max: 30 }).withMessage('Valid bank account number required.'),
  body('bank_ifsc').trim().matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Valid IFSC code required.'),
  validateRequest,
  requestWithdrawal
);

module.exports = router;
