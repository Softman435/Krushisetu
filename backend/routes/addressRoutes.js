const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  listAddresses, addAddress, updateAddress, deleteAddress,
} = require('../controllers/addressController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

const addressValidator = [
  body('full_name').trim().notEmpty().withMessage('Full name is required.').isLength({ max: 100 }),
  body('phone').trim().matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit phone number required.'),
  body('address_line').trim().notEmpty().withMessage('Address is required.').isLength({ max: 255 }),
  body('city').trim().notEmpty().withMessage('City is required.'),
  body('state').trim().notEmpty().withMessage('State is required.'),
  body('pincode').trim().matches(/^\d{6}$/).withMessage('Pincode must be a 6-digit number.'),
  body('is_default').optional().isBoolean(),
];

router.use(protect, authorize('customer'));

router.get('/', listAddresses);
router.post('/', addressValidator, validateRequest, addAddress);
router.put('/:id', param('id').isInt(), addressValidator, validateRequest, updateAddress);
router.delete('/:id', param('id').isInt(), validateRequest, deleteAddress);

module.exports = router;
