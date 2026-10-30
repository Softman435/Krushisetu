const { body } = require('express-validator');

const nameRule = body('name')
  .trim()
  .notEmpty().withMessage('Name is required.')
  .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters.')
  .matches(/^[a-zA-Z\s.'-]+$/).withMessage('Name may only contain letters and spaces.');

const emailRule = body('email')
  .trim()
  .notEmpty().withMessage('Email is required.')
  .isEmail().withMessage('Please provide a valid email address.')
  .normalizeEmail();

const phoneRule = body('phone')
  .trim()
  .notEmpty().withMessage('Phone number is required.')
  .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid 10-digit Indian mobile number.');

const passwordRule = body('password')
  .notEmpty().withMessage('Password is required.')
  .isLength({ min: 8, max: 72 }).withMessage('Password must be at least 8 characters long.')
  .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter.')
  .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
  .matches(/\d/).withMessage('Password must contain at least one number.')
  .matches(/[^A-Za-z0-9]/).withMessage('Password must contain at least one special character.');

const registerFarmerValidator = [
  nameRule,
  emailRule,
  phoneRule,
  passwordRule,
  body('address_line').trim().notEmpty().withMessage('Address is required.'),
  body('district').trim().notEmpty().withMessage('District is required.'),
  body('state').trim().notEmpty().withMessage('State is required.'),
  body('pincode').trim().matches(/^\d{6}$/).withMessage('Pincode must be a 6-digit number.'),
  body('farm_name').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
];

const registerCustomerValidator = [nameRule, emailRule, phoneRule, passwordRule];

const loginValidator = [
  body('emailOrPhone')
    .trim()
    .notEmpty().withMessage('Email or phone number is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

const changePasswordValidator = [
  body('currentPassword').notEmpty().withMessage('Current password is required.'),
  body('newPassword')
    .isLength({ min: 8, max: 72 }).withMessage('New password must be at least 8 characters long.')
    .matches(/[a-z]/).withMessage('New password must contain a lowercase letter.')
    .matches(/[A-Z]/).withMessage('New password must contain an uppercase letter.')
    .matches(/\d/).withMessage('New password must contain a number.')
    .matches(/[^A-Za-z0-9]/).withMessage('New password must contain a special character.')
    .custom((value, { req }) => value !== req.body.currentPassword)
    .withMessage('New password must be different from the current password.'),
];

module.exports = {
  registerFarmerValidator,
  registerCustomerValidator,
  loginValidator,
  changePasswordValidator,
};
