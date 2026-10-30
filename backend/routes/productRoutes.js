const express = require('express');
const router = express.Router();

const {
  createProduct,
  updateProduct,
  deleteProduct,
  listProducts,
  getProductById,
  getMyProducts,
} = require('../controllers/productController');

const { protect, authorize } = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuth');
const validateRequest = require('../middleware/validateRequest');
const {
  createProductValidator,
  updateProductValidator,
  productIdParamValidator,
  listProductsQueryValidator,
} = require('../validators/productValidator');

// Public marketplace browsing
router.get('/', listProductsQueryValidator, validateRequest, listProducts);

// Farmer's own product list — must be BEFORE the /:id route to avoid being
// captured by the numeric id param matcher.
router.get('/farmer/mine', protect, authorize('farmer'), getMyProducts);

router.get('/:id', productIdParamValidator, validateRequest, optionalAuth, getProductById);

router.post('/', protect, authorize('farmer'), createProductValidator, validateRequest, createProduct);
router.put('/:id', protect, authorize('farmer'), updateProductValidator, validateRequest, updateProduct);
router.delete('/:id', protect, authorize('farmer'), productIdParamValidator, validateRequest, deleteProduct);

module.exports = router;
