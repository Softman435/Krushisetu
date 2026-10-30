const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const admin = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

// Every route below requires an authenticated admin.
router.use(protect, authorize('admin'));

router.get('/dashboard/summary', admin.getDashboardSummary);

// Users
router.get('/farmers', admin.listFarmers);
router.get('/customers', admin.listCustomers);
router.patch(
  '/users/:id/active',
  param('id').isInt({ min: 1 }),
  body('is_active').isBoolean(),
  validateRequest,
  admin.toggleUserActive
);
router.patch('/farmers/:id/approve', param('id').isInt({ min: 1 }), validateRequest, admin.approveFarmerProfile);

// Products
router.get('/products', query('status').optional().isIn(['pending', 'approved', 'rejected', 'disabled']), validateRequest, admin.listProductsForReview);
router.patch('/products/:id/approve', param('id').isInt({ min: 1 }), validateRequest, admin.approveProduct);
router.patch(
  '/products/:id/reject',
  param('id').isInt({ min: 1 }),
  body('reason').trim().notEmpty().isLength({ max: 255 }),
  validateRequest,
  admin.rejectProduct
);
router.patch('/products/:id/disable', param('id').isInt({ min: 1 }), validateRequest, admin.disableProduct);

// Delivery charges
router.get('/delivery-charges', admin.listDeliveryCharges);
router.post(
  '/delivery-charges',
  body('category_id').isInt({ min: 1 }),
  body('base_charge').isFloat({ min: 0 }),
  body('per_kg_charge').isFloat({ min: 0 }),
  body('free_above_amount').optional({ nullable: true }).isFloat({ min: 0 }),
  validateRequest,
  admin.setDeliveryCharge
);

// Orders
router.get(
  '/orders',
  query('status').optional().isIn(['placed', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned']),
  query('payment_status').optional().isIn(['pending', 'paid', 'failed', 'refunded']),
  validateRequest,
  admin.listAllOrders
);

// Refunds
router.get('/refunds', admin.listRefunds);
router.patch(
  '/refunds/:id',
  param('id').isInt({ min: 1 }),
  body('status').isIn(['processing', 'completed', 'rejected']),
  validateRequest,
  admin.updateRefundStatus
);

// Wallets & withdrawals
router.get('/wallets', admin.listFarmerWallets);
router.get('/withdrawals', query('status').optional().isIn(['requested', 'approved', 'processed', 'rejected']), validateRequest, admin.listWithdrawals);
router.patch(
  '/withdrawals/:id',
  param('id').isInt({ min: 1 }),
  body('status').isIn(['approved', 'processed', 'rejected']),
  body('admin_remark').optional({ checkFalsy: true }).trim().isLength({ max: 255 }),
  validateRequest,
  admin.updateWithdrawalStatus
);

// Payment issues
router.get('/payment-issues', admin.listPaymentIssues);
router.patch(
  '/payment-issues/:id',
  param('id').isInt({ min: 1 }),
  body('status').isIn(['in_progress', 'resolved', 'closed']),
  body('admin_response').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  validateRequest,
  admin.resolvePaymentIssue
);

module.exports = router;
