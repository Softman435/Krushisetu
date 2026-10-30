const { verifyAccessToken } = require('../utils/tokenUtils');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Verifies the JWT access token sent as: Authorization: Bearer <token>
 * Attaches the authenticated user's { id, role, email } to req.user.
 * Also re-checks the user's active/lock status against the DB on every
 * request, so a deactivated or banned account is rejected immediately
 * even if their token has not expired yet.
 */
const protect = asyncHandler(async (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    throw new AppError('Not authenticated. Please log in.', 401);
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Session expired. Please log in again.', 401);
    }
    throw new AppError('Invalid authentication token.', 401);
  }

  const [rows] = await pool.query(
    'SELECT id, name, email, role, is_active, lock_until FROM users WHERE id = :id LIMIT 1',
    { id: decoded.id }
  );

  const user = rows[0];
  if (!user) {
    throw new AppError('The account for this token no longer exists.', 401);
  }
  if (!user.is_active) {
    throw new AppError('This account has been deactivated. Contact support.', 403);
  }
  if (user.lock_until && new Date(user.lock_until) > new Date()) {
    throw new AppError('Account temporarily locked. Try again later.', 423);
  }

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
});

/**
 * Role-based access control. Usage: authorize('admin') or authorize('farmer','admin')
 * Must be used AFTER `protect`.
 */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Not authenticated.', 401));
  }
  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action.', 403));
  }
  next();
};

module.exports = { protect, authorize };
