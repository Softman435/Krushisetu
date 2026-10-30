/**
 * One-time script to create the first Admin account.
 * Run with:  npm run seed:admin
 * Reads DEFAULT_ADMIN_* values from .env. Safe to re-run — it will
 * refuse to create a duplicate if an admin with that email already exists.
 */
require('../config/env');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

(async () => {
  const name = process.env.DEFAULT_ADMIN_NAME;
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const phone = process.env.DEFAULT_ADMIN_PHONE;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;

  if (!name || !email || !phone || !password) {
    console.error('Missing DEFAULT_ADMIN_* values in .env');
    process.exit(1);
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE email = :email OR role = "admin"', { email });
  if (existing.length) {
    console.log('An admin account already exists. Skipping seed.');
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
  const [result] = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, is_verified)
     VALUES (:name, :email, :phone, :passwordHash, 'admin', 1)`,
    { name, email, phone, passwordHash }
  );

  console.log(`Admin created with id ${result.insertId}. Email: ${email}`);
  console.log('IMPORTANT: log in and change this password immediately.');
  process.exit(0);
})().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
