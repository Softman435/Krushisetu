const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');

function gradeColumns(grade) {
  const map = {
    A: { price: 'grade_a_price', qty: 'grade_a_quantity' },
    B: { price: 'grade_b_price', qty: 'grade_b_quantity' },
    C: { price: 'grade_c_price', qty: 'grade_c_quantity' },
  };
  return map[grade];
}

const getCart = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ci.id AS cart_item_id, ci.grade, ci.quantity,
            p.id AS product_id, p.name, p.unit, p.image_url, p.is_available, p.status,
            p.grade_a_price, p.grade_a_quantity,
            p.grade_b_price, p.grade_b_quantity,
            p.grade_c_price, p.grade_c_quantity
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.customer_id = :customerId
     ORDER BY ci.created_at DESC`,
    { customerId: req.user.id }
  );

  let subtotal = 0;
  const items = rows.map((r) => {
    const { price: priceCol, qty: qtyCol } = gradeColumns(r.grade);
    const unitPrice = Number(r[priceCol]);
    const availableQty = Number(r[qtyCol]);
    const lineTotal = unitPrice * Number(r.quantity);
    subtotal += lineTotal;
    return {
      cart_item_id: r.cart_item_id,
      product_id: r.product_id,
      name: r.name,
      unit: r.unit,
      image_url: r.image_url,
      grade: r.grade,
      quantity: Number(r.quantity),
      unit_price: unitPrice,
      line_total: Number(lineTotal.toFixed(2)),
      available_quantity: availableQty,
      in_stock: Boolean(r.is_available) && r.status === 'approved' &&
        r[priceCol] != null && availableQty >= Number(r.quantity),
    };
  });

  return success(res, 200, 'Cart fetched.', { items, subtotal: Number(subtotal.toFixed(2)) });
});

const addToCart = asyncHandler(async (req, res) => {
  const { product_id, grade, quantity } = req.body;

  const [productRows] = await pool.query(
    'SELECT * FROM products WHERE id = :id AND status = "approved" AND is_available = 1',
    { id: product_id }
  );
  if (!productRows.length) throw new AppError('Product not available.', 404);

  const product = productRows[0];
  const { price: priceCol, qty: qtyCol } = gradeColumns(grade);
  if (!priceCol || !qtyCol) throw new AppError('Choose a valid product grade.', 400);
  if (product[priceCol] == null) throw new AppError(`Grade ${grade} is not offered for this product.`, 400);
  if (Number(product[qtyCol]) < Number(quantity)) {
    throw new AppError(`Only ${product[qtyCol]} ${product.unit} available in Grade ${grade}.`, 400);
  }

  await pool.query(
    `INSERT INTO cart_items (customer_id, product_id, grade, quantity)
     VALUES (:customerId, :productId, :grade, :quantity)
     ON DUPLICATE KEY UPDATE quantity = :quantity`,
    { customerId: req.user.id, productId: product_id, grade, quantity }
  );

  return success(res, 200, 'Item added to cart.');
});

const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const [rows] = await pool.query(
    `SELECT ci.*, p.grade_a_price, p.grade_a_quantity,
            p.grade_b_price, p.grade_b_quantity,
            p.grade_c_price, p.grade_c_quantity,
            p.unit, p.is_available, p.status
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.id = :id AND ci.customer_id = :customerId`,
    { id: req.params.id, customerId: req.user.id }
  );
  if (!rows.length) throw new AppError('Cart item not found.', 404);

  const item = rows[0];
  const { price: priceCol, qty: qtyCol } = gradeColumns(item.grade);
  if (!item.is_available || item.status !== 'approved' || item[priceCol] == null) {
    throw new AppError('This product grade is no longer available.', 409);
  }
  if (Number(item[qtyCol]) < Number(quantity)) {
    throw new AppError(`Only ${item[qtyCol]} ${item.unit} available in Grade ${item.grade}.`, 400);
  }

  await pool.query('UPDATE cart_items SET quantity = :quantity WHERE id = :id', {
    quantity, id: req.params.id,
  });
  return success(res, 200, 'Cart item updated.');
});

const removeCartItem = asyncHandler(async (req, res) => {
  const [result] = await pool.query('DELETE FROM cart_items WHERE id = :id AND customer_id = :customerId', {
    id: req.params.id, customerId: req.user.id,
  });
  if (!result.affectedRows) throw new AppError('Cart item not found.', 404);
  return success(res, 200, 'Item removed from cart.');
});

const clearCart = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM cart_items WHERE customer_id = :customerId', { customerId: req.user.id });
  return success(res, 200, 'Cart cleared.');
});

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart };
