const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

/**
 * POST /api/products   (farmer only)
 * New products always start life as 'pending' until an admin approves them.
 */
const createProduct = asyncHandler(async (req, res) => {
  const {
    name, category_id, description, unit, image_url,
    grade_a_price, grade_a_quantity,
    grade_b_price, grade_b_quantity,
    grade_c_price, grade_c_quantity,
  } = req.body;

  const [cat] = await pool.query('SELECT id FROM categories WHERE id = :id AND is_active = 1', { id: category_id });
  if (!cat.length) throw new AppError('Selected category does not exist or is inactive.', 400);

  const [result] = await pool.query(
    `INSERT INTO products
      (farmer_id, category_id, name, description, unit, image_url,
       grade_a_price, grade_a_quantity, grade_b_price, grade_b_quantity,
       grade_c_price, grade_c_quantity, status)
     VALUES
      (:farmer_id, :category_id, :name, :description, :unit, :image_url,
       :grade_a_price, :grade_a_quantity, :grade_b_price, :grade_b_quantity,
       :grade_c_price, :grade_c_quantity, 'pending')`,
    {
      farmer_id: req.user.id, category_id, name, description: description || null, unit, image_url: image_url || null,
      grade_a_price: grade_a_price ?? null, grade_a_quantity: grade_a_quantity ?? 0,
      grade_b_price: grade_b_price ?? null, grade_b_quantity: grade_b_quantity ?? 0,
      grade_c_price: grade_c_price ?? null, grade_c_quantity: grade_c_quantity ?? 0,
    }
  );

  return success(res, 201, 'Product submitted for admin approval.', { id: result.insertId });
});

/**
 * PUT /api/products/:id   (farmer, own product only; resets to pending)
 */
const updateProduct = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const [rows] = await pool.query('SELECT farmer_id FROM products WHERE id = :id', { id: productId });
  if (!rows.length) throw new AppError('Product not found.', 404);
  if (rows[0].farmer_id !== req.user.id) throw new AppError('You can only edit your own products.', 403);

  const {
    name, category_id, description, unit, image_url,
    grade_a_price, grade_a_quantity,
    grade_b_price, grade_b_quantity,
    grade_c_price, grade_c_quantity,
  } = req.body;

  await pool.query(
    `UPDATE products SET
       name = :name, category_id = :category_id, description = :description, unit = :unit,
       image_url = :image_url,
       grade_a_price = :grade_a_price, grade_a_quantity = :grade_a_quantity,
       grade_b_price = :grade_b_price, grade_b_quantity = :grade_b_quantity,
       grade_c_price = :grade_c_price, grade_c_quantity = :grade_c_quantity,
       status = 'pending', rejection_reason = NULL
     WHERE id = :id`,
    {
      id: productId, name, category_id, description: description || null, unit, image_url: image_url || null,
      grade_a_price: grade_a_price ?? null, grade_a_quantity: grade_a_quantity ?? 0,
      grade_b_price: grade_b_price ?? null, grade_b_quantity: grade_b_quantity ?? 0,
      grade_c_price: grade_c_price ?? null, grade_c_quantity: grade_c_quantity ?? 0,
    }
  );

  return success(res, 200, 'Product updated and resubmitted for admin approval.');
});

/**
 * DELETE /api/products/:id   (farmer, own product only)
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const [rows] = await pool.query('SELECT farmer_id FROM products WHERE id = :id', { id: productId });
  if (!rows.length) throw new AppError('Product not found.', 404);
  if (rows[0].farmer_id !== req.user.id) throw new AppError('You can only delete your own products.', 403);

  await pool.query('DELETE FROM products WHERE id = :id', { id: productId });
  return success(res, 200, 'Product deleted.');
});

/**
 * GET /api/products   (public marketplace listing — approved & available only)
 * Supports filtering by category, grade, price range, search, pagination.
 */
const listProducts = asyncHandler(async (req, res) => {
  const {
    category_id, grade, min_price, max_price, search,
    page = 1, limit = 20,
  } = req.query;

  const where = [
    "p.status = 'approved'",
    'p.is_available = 1',
    `(
      (p.grade_a_price IS NOT NULL AND p.grade_a_quantity > 0) OR
      (p.grade_b_price IS NOT NULL AND p.grade_b_quantity > 0) OR
      (p.grade_c_price IS NOT NULL AND p.grade_c_quantity > 0)
    )`,
  ];
  const params = {};

  if (category_id) { where.push('p.category_id = :category_id'); params.category_id = category_id; }
  if (search) { where.push('p.name LIKE :search'); params.search = `%${search}%`; }

  let priceColumn = null;
  let quantityColumn = null;
  if (grade === 'A') { priceColumn = 'p.grade_a_price'; quantityColumn = 'p.grade_a_quantity'; }
  if (grade === 'B') { priceColumn = 'p.grade_b_price'; quantityColumn = 'p.grade_b_quantity'; }
  if (grade === 'C') { priceColumn = 'p.grade_c_price'; quantityColumn = 'p.grade_c_quantity'; }

  if (priceColumn) {
    where.push(`${priceColumn} IS NOT NULL`, `${quantityColumn} > 0`);
    if (min_price) { where.push(`${priceColumn} >= :min_price`); params.min_price = min_price; }
    if (max_price) { where.push(`${priceColumn} <= :max_price`); params.max_price = max_price; }
  } else if (min_price || max_price) {
    // No specific grade requested — match if ANY grade price falls in range.
    const clauses = ['p.grade_a_price', 'p.grade_b_price', 'p.grade_c_price'].map((col) => {
      const quantity = col.replace('_price', '_quantity');
      const parts = [`${col} IS NOT NULL`, `${quantity} > 0`];
      if (min_price) parts.push(`${col} >= :min_price`);
      if (max_price) parts.push(`${col} <= :max_price`);
      return `(${parts.join(' AND ')})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
    if (min_price) params.min_price = min_price;
    if (max_price) params.max_price = max_price;
  }

  const offset = (Number(page) - 1) * Number(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.description, p.unit, p.image_url,
            p.grade_a_price, p.grade_a_quantity,
            p.grade_b_price, p.grade_b_quantity,
            p.grade_c_price, p.grade_c_quantity,
            c.name AS category_name, u.name AS farmer_name
     FROM products p
     JOIN categories c ON c.id = p.category_id
     JOIN users u ON u.id = p.farmer_id
     ${whereSql}
     ORDER BY p.created_at DESC
     LIMIT :limit OFFSET :offset`,
    { ...params, limit: Number(limit), offset }
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM products p ${whereSql}`,
    params
  );

  return success(res, 200, 'Products fetched.', rows, {
    page: Number(page), limit: Number(limit), total: countRows[0].total,
  });
});

/**
 * GET /api/products/:id   (public — single product detail)
 */
const getProductById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, u.name AS farmer_name
     FROM products p
     JOIN categories c ON c.id = p.category_id
     JOIN users u ON u.id = p.farmer_id
     WHERE p.id = :id`,
    { id: req.params.id }
  );
  if (!rows.length) throw new AppError('Product not found.', 404);

  const product = rows[0];
  // Non-admin/non-owner users should not see pending/rejected products.
  const isOwner = req.user && req.user.id === product.farmer_id;
  const isAdmin = req.user && req.user.role === 'admin';
  if (product.status !== 'approved' && !isOwner && !isAdmin) {
    throw new AppError('Product not found.', 404);
  }

  return success(res, 200, 'Product fetched.', product);
});

/**
 * GET /api/products/farmer/mine   (farmer only — own products, any status)
 */
const getMyProducts = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.farmer_id = :farmerId ORDER BY p.created_at DESC`,
    { farmerId: req.user.id }
  );
  return success(res, 200, 'Your products fetched.', rows);
});

module.exports = {
  createProduct,
  updateProduct,
  deleteProduct,
  listProducts,
  getProductById,
  getMyProducts,
};
