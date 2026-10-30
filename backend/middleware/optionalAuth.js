const { verifyAccessToken } = require('../utils/tokenUtils');
const { pool } = require('../config/db');

/**
 * Like `protect`, but never rejects the request. If a valid token is
 * present, req.user is populated; otherwise req.user stays undefined
 * and the request proceeds as an anonymous visitor.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = :id LIMIT 1',
      { id: decoded.id }
    );
    if (rows.length && rows[0].is_active) {
      req.user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    }
  } catch {
    // Invalid/expired token on an optional route — just treat as anonymous.
  }
  next();
};

module.exports = optionalAuth;
