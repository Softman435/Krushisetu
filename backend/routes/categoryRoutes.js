const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listAllCategoriesAdmin,
} = require('../controllers/categoryController');

const { protect, authorize } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');

const categoryValidator = [
  body('name').trim().notEmpty().withMessage('Category name is required.').isLength({ max: 100 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 255 }),
];

router.get('/', listCategories);

router.get('/admin/all', protect, authorize('admin'), listAllCategoriesAdmin);
router.post('/', protect, authorize('admin'), categoryValidator, validateRequest, createCategory);
router.put('/:id', protect, authorize('admin'), param('id').isInt(), categoryValidator, validateRequest, updateCategory);
router.delete('/:id', protect, authorize('admin'), param('id').isInt(), validateRequest, deleteCategory);

module.exports = router;
