const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  checkout, getMyOrders, getOrderById, getFarmerOrderItems, updateOrderItemStatus, cancelOrder,
} = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

router.use(protect);

router.post(
  '/checkout',
  authorize('customer'),
  body('address_id').isInt({ min: 1 }).withMessage('Delivery address is required.'),
  body('payment_method').isIn(['COD', 'RAZORPAY']).withMessage('Invalid payment method.'),
  validateRequest,
  checkout
);

router.get('/my', authorize('customer'), getMyOrders);
router.get('/farmer/mine', authorize('farmer'), getFarmerOrderItems);
router.get('/:id', param('id').isInt({ min: 1 }), validateRequest, getOrderById);

router.patch(
  '/items/:itemId/status',
  authorize('farmer'),
  param('itemId').isInt({ min: 1 }),
  body('status').isIn(['confirmed', 'shipped', 'delivered']),
  validateRequest,
  updateOrderItemStatus
);

router.patch(
  '/:id/cancel',
  authorize('customer'),
  param('id').isInt({ min: 1 }),
  body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 255 }),
  validateRequest,
  cancelOrder
);

module.exports = router;
