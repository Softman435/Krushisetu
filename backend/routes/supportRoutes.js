const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const { raiseIssue, getMyIssues } = require('../controllers/supportController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

router.use(protect, authorize('customer', 'farmer'));

router.get('/', getMyIssues);
router.post(
  '/',
  body('order_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('subject').trim().notEmpty().withMessage('Subject is required.').isLength({ max: 150 }),
  body('description').trim().notEmpty().withMessage('Description is required.').isLength({ max: 2000 }),
  validateRequest,
  raiseIssue
);

module.exports = router;
