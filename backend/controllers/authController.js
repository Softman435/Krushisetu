const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { success } = require('../utils/apiResponse');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokenUtils');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCK_TIME_MINUTES = Number(process.env.LOCK_TIME_MINUTES) || 15;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, keep in sync with JWT_REFRESH_EXPIRES
  path: '/api/auth',
};

async function issueTokens(res, user) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store only a hash of the refresh token so a leaked DB dump can't be
  // replayed as a valid session.
  const refreshHash = await bcrypt.hash(refreshToken, 10);
  await pool.query('UPDATE users SET refresh_token = :hash WHERE id = :id', {
    hash: refreshHash,
    id: user.id,
  });

  res.cookie('refreshToken', refreshToken, cookieOptions);
  return accessToken;
}

/**
 * POST /api/auth/register/farmer
 */
const registerFarmer = asyncHandler(async (req, res) => {
  const {
    name, email, phone, password,
    farm_name, address_line, village, district, state, pincode,
  } = req.body;

  const [existing] = await pool.query(
    'SELECT id FROM users WHERE email = :email OR phone = :phone LIMIT 1',
    { email, phone }
  );
  if (existing.length) {
    throw new AppError('An account with this email or phone already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [userResult] = await conn.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES (:name, :email, :phone, :passwordHash, 'farmer')`,
      { name, email, phone, passwordHash }
    );
    const userId = userResult.insertId;

    await conn.query(
      `INSERT INTO farmer_profiles
        (user_id, farm_name, address_line, village, district, state, pincode)
       VALUES (:userId, :farm_name, :address_line, :village, :district, :state, :pincode)`,
      { userId, farm_name: farm_name || null, address_line, village: village || null, district, state, pincode }
    );

    await conn.query('INSERT INTO wallets (farmer_id, balance) VALUES (:userId, 0)', { userId });

    await conn.commit();

    return success(res, 201, 'Farmer registered successfully. Your account is pending admin approval for product listing.', {
      id: userId, name, email, phone, role: 'farmer',
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * POST /api/auth/register/customer
 */
const registerCustomer = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;

  const [existing] = await pool.query(
    'SELECT id FROM users WHERE email = :email OR phone = :phone LIMIT 1',
    { email, phone }
  );
  if (existing.length) {
    throw new AppError('An account with this email or phone already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [userResult] = await conn.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES (:name, :email, :phone, :passwordHash, 'customer')`,
      { name, email, phone, passwordHash }
    );
    const userId = userResult.insertId;
    await conn.query('INSERT INTO customer_profiles (user_id) VALUES (:userId)', { userId });
    await conn.commit();

    return success(res, 201, 'Customer registered successfully.', {
      id: userId, name, email, phone, role: 'customer',
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * POST /api/auth/login
 * Body: { emailOrPhone, password }
 * Works for all three roles (farmer, customer, admin).
 */
const login = asyncHandler(async (req, res) => {
  const { emailOrPhone, password } = req.body;

  const [rows] = await pool.query(
    `SELECT id, name, email, phone, password_hash, role, is_active,
            failed_login_attempts, lock_until
     FROM users WHERE email = :val OR phone = :val LIMIT 1`,
    { val: emailOrPhone }
  );
  const user = rows[0];

  // Same generic message whether the account exists or not, to avoid
  // leaking which identifiers are registered.
  const invalidCredsError = () => new AppError('Invalid email/phone or password.', 401);

  if (!user) throw invalidCredsError();

  if (user.lock_until && new Date(user.lock_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.lock_until) - new Date()) / 60000);
    throw new AppError(`Account locked due to multiple failed attempts. Try again in ${minutesLeft} minute(s).`, 423);
  }

  if (!user.is_active) {
    throw new AppError('This account has been deactivated. Contact support.', 403);
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    const attempts = user.failed_login_attempts + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCK_TIME_MINUTES * 60 * 1000);
      await pool.query(
        'UPDATE users SET failed_login_attempts = 0, lock_until = :lockUntil WHERE id = :id',
        { lockUntil, id: user.id }
      );
      throw new AppError(`Too many failed attempts. Account locked for ${LOCK_TIME_MINUTES} minutes.`, 423);
    }
    await pool.query('UPDATE users SET failed_login_attempts = :attempts WHERE id = :id', {
      attempts, id: user.id,
    });
    throw invalidCredsError();
  }

  // Successful login: reset attempt counter
  await pool.query(
    'UPDATE users SET failed_login_attempts = 0, lock_until = NULL WHERE id = :id',
    { id: user.id }
  );

  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  const accessToken = await issueTokens(res, safeUser);

  return success(res, 200, 'Login successful.', { user: safeUser, accessToken });
});

/**
 * POST /api/auth/refresh
 * Reads httpOnly refresh cookie, issues a new access token.
 */
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new AppError('No refresh token provided.', 401);

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid or expired refresh token. Please log in again.', 401);
  }

  const [rows] = await pool.query(
    'SELECT id, name, email, role, refresh_token, is_active FROM users WHERE id = :id LIMIT 1',
    { id: decoded.id }
  );
  const user = rows[0];
  if (!user || !user.is_active || !user.refresh_token) {
    throw new AppError('Session invalid. Please log in again.', 401);
  }

  const matches = await bcrypt.compare(token, user.refresh_token);
  if (!matches) {
    // Possible token theft/reuse — invalidate the stored token defensively.
    await pool.query('UPDATE users SET refresh_token = NULL WHERE id = :id', { id: user.id });
    throw new AppError('Session invalid. Please log in again.', 401);
  }

  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  const accessToken = await issueTokens(res, safeUser); // rotate refresh token too

  return success(res, 200, 'Token refreshed.', { user: safeUser, accessToken });
});

/**
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      await pool.query('UPDATE users SET refresh_token = NULL WHERE id = :id', { id: decoded.id });
    } catch {
      // token already invalid/expired — nothing to clean up
    }
  }
  res.clearCookie('refreshToken', { path: '/api/auth' });
  return success(res, 200, 'Logged out successfully.');
});

/**
 * GET /api/auth/me   (protected)
 */
const getMe = asyncHandler(async (req, res) => {
  return success(res, 200, 'Current user fetched.', { user: req.user });
});

/**
 * PATCH /api/auth/change-password   (protected)
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = :id', { id: req.user.id });
  const user = rows[0];
  if (!user) throw new AppError('User not found.', 404);

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) throw new AppError('Current password is incorrect.', 401);

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await pool.query(
    'UPDATE users SET password_hash = :newHash, refresh_token = NULL WHERE id = :id',
    { newHash, id: req.user.id }
  );

  res.clearCookie('refreshToken', { path: '/api/auth' });
  return success(res, 200, 'Password changed successfully. Please log in again.');
});

module.exports = {
  registerFarmer,
  registerCustomer,
  login,
  refresh,
  logout,
  getMe,
  changePassword,
};
