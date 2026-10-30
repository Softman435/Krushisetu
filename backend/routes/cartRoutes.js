const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  getCart, addToCart, updateCartItem, removeCartItem, clearCart,
} = require('../controllers/cartController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

const quantityValidator = () => body('quantity')
  .isFloat({ gt: 0, max: 99999999.99 })
  .withMessage('Quantity must be greater than 0.')
  .bail()
  .custom((value) => /^\d{1,8}(?:\.\d{1,2})?$/.test(String(value)))
  .withMessage('Quantity can have up to 2 decimal places.');

router.use(protect, authorize('customer'));

router.get('/', getCart);

router.post(
  '/',
  body('product_id').isInt({ min: 1 }).withMessage('Valid product is required.'),
  body('grade').isIn(['A', 'B', 'C']).withMessage('Grade must be A, B, or C.'),
  quantityValidator(),
  validateRequest,
  addToCart
);

router.put(
  '/:id',
  param('id').isInt({ min: 1 }),
  quantityValidator(),
  validateRequest,
  updateCartItem
);

router.delete('/:id', param('id').isInt({ min: 1 }), validateRequest, removeCartItem);
router.delete('/', clearCart);

module.exports = router;
