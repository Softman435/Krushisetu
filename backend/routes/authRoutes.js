const express = require('express');
const router = express.Router();

const {
  registerFarmer,
  registerCustomer,
  login,
  refresh,
  logout,
  getMe,
  changePassword,
} = require('../controllers/authController');

const { protect } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');
const { authLimiter } = require('../middleware/rateLimiters');
const {
  registerFarmerValidator,
  registerCustomerValidator,
  loginValidator,
  changePasswordValidator,
} = require('../validators/authValidator');

router.post('/register/farmer', authLimiter, registerFarmerValidator, validateRequest, registerFarmer);
router.post('/register/customer', authLimiter, registerCustomerValidator, validateRequest, registerCustomer);
router.post('/login', authLimiter, loginValidator, validateRequest, login);
router.post('/refresh', refresh);
router.post('/logout', logout);

router.get('/me', protect, getMe);
router.patch('/change-password', protect, changePasswordValidator, validateRequest, changePassword);

module.exports = router;
