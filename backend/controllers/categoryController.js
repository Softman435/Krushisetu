const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

const listCategories = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, description FROM categories WHERE is_active = 1 ORDER BY name');
  return success(res, 200, 'Categories fetched.', rows);
});

// ---- Admin-only management below ----

const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const [existing] = await pool.query('SELECT id FROM categories WHERE name = :name', { name });
  if (existing.length) throw new AppError('Category already exists.', 409);

  const [result] = await pool.query(
    'INSERT INTO categories (name, description) VALUES (:name, :description)',
    { name, description: description || null }
  );
  return success(res, 201, 'Category created.', { id: result.insertId });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, is_active } = req.body;
  const [existing] = await pool.query('SELECT id FROM categories WHERE id = :id', { id: req.params.id });
  if (!existing.length) throw new AppError('Category not found.', 404);

  await pool.query(
    'UPDATE categories SET name = :name, description = :description, is_active = :is_active WHERE id = :id',
    { id: req.params.id, name, description: description || null, is_active: is_active ? 1 : 0 }
  );
  return success(res, 200, 'Category updated.');
});

const deleteCategory = asyncHandler(async (req, res) => {
  await pool.query('UPDATE categories SET is_active = 0 WHERE id = :id', { id: req.params.id });
  return success(res, 200, 'Category deactivated.');
});

const listAllCategoriesAdmin = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories ORDER BY name');
  return success(res, 200, 'All categories fetched.', rows);
});

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listAllCategoriesAdmin,
};
