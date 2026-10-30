const { body, param, query } = require('express-validator');

const createProductValidator = [
  body('name').trim().notEmpty().withMessage('Product name is required.')
    .isLength({ max: 150 }).withMessage('Product name too long.'),
  body('category_id').notEmpty().withMessage('Category is required.').isInt({ min: 1 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  body('unit').isIn(['kg', 'gram', 'litre', 'dozen', 'piece', 'quintal'])
    .withMessage('Invalid unit.'),

  body('grade_a_price').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Grade A price must be a positive number.'),
  body('grade_a_quantity').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Grade A quantity must be a positive number.'),
  body('grade_b_price').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Grade B price must be a positive number.'),
  body('grade_b_quantity').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Grade B quantity must be a positive number.'),
  body('grade_c_price').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Grade C price must be a positive number.'),
  body('grade_c_quantity').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Grade C quantity must be a positive number.'),

  body().custom((value) => {
    if (
      value.grade_a_price == null &&
      value.grade_b_price == null &&
      value.grade_c_price == null
    ) {
      throw new Error('At least one grade (A, B, or C) must have a price set.');
    }
    return true;
  }),
];

const updateProductValidator = [
  param('id').isInt({ min: 1 }).withMessage('Invalid product id.'),
  ...createProductValidator,
];

const productIdParamValidator = [
  param('id').isInt({ min: 1 }).withMessage('Invalid product id.'),
];

const listProductsQueryValidator = [
  query('category_id').optional().isInt({ min: 1 }),
  query('grade').optional().isIn(['A', 'B', 'C']),
  query('min_price').optional().isFloat({ min: 0 }),
  query('max_price').optional().isFloat({ min: 0 }),
  query('search').optional().trim().isLength({ max: 100 }),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const rejectProductValidator = [
  param('id').isInt({ min: 1 }).withMessage('Invalid product id.'),
  body('reason').trim().notEmpty().withMessage('Rejection reason is required.').isLength({ max: 255 }),
];

module.exports = {
  createProductValidator,
  updateProductValidator,
  productIdParamValidator,
  listProductsQueryValidator,
  rejectProductValidator,
};
