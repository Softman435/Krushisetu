const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const {
  createRazorpayOrder, verifyRazorpayPayment,
} = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

router.post(
  '/razorpay/create-order',
  protect, authorize('customer'),
  body('order_id').isInt({ min: 1 }),
  validateRequest,
  createRazorpayOrder
);

router.post(
  '/razorpay/verify',
  protect, authorize('customer'),
  body('order_id').isInt({ min: 1 }),
  body('razorpay_order_id').notEmpty(),
  body('razorpay_payment_id').notEmpty(),
  body('razorpay_signature').notEmpty(),
  validateRequest,
  verifyRazorpayPayment
);

// Note: the /razorpay/webhook endpoint is registered directly in app.js
// (before the global JSON body parser) so it can access the raw request
// body for signature verification. See app.js for details.

module.exports = router;
