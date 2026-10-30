-- =====================================================================
-- KrushiSetu Database Schema
-- Farmer-to-Customer Agricultural Marketplace
-- =====================================================================

CREATE DATABASE IF NOT EXISTS krushisetu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE krushisetu;

-- ---------------------------------------------------------------------
-- USERS  (base table for Farmer / Customer / Admin authentication)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(100)  NOT NULL,
  email             VARCHAR(150)  NOT NULL UNIQUE,
  phone             VARCHAR(15)   NOT NULL UNIQUE,
  password_hash     VARCHAR(255)  NOT NULL,
  role              ENUM('farmer','customer','admin') NOT NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  is_verified       TINYINT(1)    NOT NULL DEFAULT 0,
  failed_login_attempts INT       NOT NULL DEFAULT 0,
  lock_until        DATETIME      NULL,
  refresh_token     VARCHAR(500)  NULL,
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- FARMER PROFILE
-- ---------------------------------------------------------------------
CREATE TABLE farmer_profiles (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL UNIQUE,
  farm_name         VARCHAR(150),
  address_line      VARCHAR(255) NOT NULL,
  village           VARCHAR(100),
  district          VARCHAR(100) NOT NULL,
  state             VARCHAR(100) NOT NULL,
  pincode           VARCHAR(10)  NOT NULL,
  bank_account_name    VARCHAR(150),
  bank_account_number  VARCHAR(30),
  bank_ifsc            VARCHAR(15),
  bank_name             VARCHAR(150),
  kyc_document_url  VARCHAR(255),
  approved          TINYINT(1) NOT NULL DEFAULT 0,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CUSTOMER PROFILE
-- ---------------------------------------------------------------------
CREATE TABLE customer_profiles (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL UNIQUE,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CUSTOMER ADDRESSES
-- ---------------------------------------------------------------------
CREATE TABLE addresses (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL,
  full_name         VARCHAR(100) NOT NULL,
  phone             VARCHAR(15)  NOT NULL,
  address_line      VARCHAR(255) NOT NULL,
  city              VARCHAR(100) NOT NULL,
  state             VARCHAR(100) NOT NULL,
  pincode           VARCHAR(10)  NOT NULL,
  is_default        TINYINT(1) NOT NULL DEFAULT 0,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CATEGORIES  (managed by Admin)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(100) NOT NULL UNIQUE,
  description       VARCHAR(255),
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- DELIVERY CHARGES  (configurable by Admin, per category)
-- ---------------------------------------------------------------------
CREATE TABLE delivery_charges (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  category_id       INT NOT NULL UNIQUE,
  base_charge       DECIMAL(10,2) NOT NULL DEFAULT 0,
  per_kg_charge     DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_above_amount DECIMAL(10,2) NULL,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PRODUCTS  (Grade A / B / C pricing, admin approval workflow)
-- ---------------------------------------------------------------------
CREATE TABLE products (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  farmer_id         INT NOT NULL,
  category_id       INT NOT NULL,
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  unit              ENUM('kg','gram','litre','dozen','piece','quintal') NOT NULL DEFAULT 'kg',
  image_url         VARCHAR(255),

  grade_a_price     DECIMAL(10,2) NULL,
  grade_a_quantity  DECIMAL(10,2) NULL DEFAULT 0,
  grade_b_price     DECIMAL(10,2) NULL,
  grade_b_quantity  DECIMAL(10,2) NULL DEFAULT 0,
  grade_c_price     DECIMAL(10,2) NULL,
  grade_c_quantity  DECIMAL(10,2) NULL DEFAULT 0,

  status            ENUM('pending','approved','rejected','disabled') NOT NULL DEFAULT 'pending',
  rejection_reason  VARCHAR(255) NULL,
  is_available      TINYINT(1) NOT NULL DEFAULT 1,

  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  INDEX idx_products_status (status),
  INDEX idx_products_category (category_id),
  CONSTRAINT chk_at_least_one_grade CHECK (
    grade_a_price IS NOT NULL OR grade_b_price IS NOT NULL OR grade_c_price IS NOT NULL
  )
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- CART  &  CART ITEMS
-- ---------------------------------------------------------------------
CREATE TABLE cart_items (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  customer_id       INT NOT NULL,
  product_id        INT NOT NULL,
  grade             ENUM('A','B','C') NOT NULL,
  quantity          DECIMAL(10,2) NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cart_item (customer_id, product_id, grade)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- ORDERS  &  ORDER ITEMS
-- ---------------------------------------------------------------------
CREATE TABLE orders (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_number      VARCHAR(30) NOT NULL UNIQUE,
  customer_id       INT NOT NULL,
  address_id        INT NOT NULL,
  subtotal          DECIMAL(10,2) NOT NULL,
  delivery_charge   DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount      DECIMAL(10,2) NOT NULL,
  payment_method    ENUM('COD','RAZORPAY') NOT NULL,
  payment_status    ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  order_status      ENUM('placed','confirmed','shipped','delivered','cancelled','returned') NOT NULL DEFAULT 'placed',
  cancellation_reason VARCHAR(255) NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id),
  FOREIGN KEY (address_id) REFERENCES addresses(id),
  INDEX idx_orders_customer (customer_id),
  INDEX idx_orders_status (order_status)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT NOT NULL,
  product_id        INT NOT NULL,
  farmer_id         INT NOT NULL,
  grade             ENUM('A','B','C') NOT NULL,
  unit_price        DECIMAL(10,2) NOT NULL,
  quantity          DECIMAL(10,2) NOT NULL,
  line_total        DECIMAL(10,2) NOT NULL,
  item_status       ENUM('pending','confirmed','shipped','delivered','cancelled','returned') NOT NULL DEFAULT 'pending',
  platform_fee      DECIMAL(10,2) NOT NULL DEFAULT 0,
  farmer_earning    DECIMAL(10,2) NOT NULL DEFAULT 0,
  wallet_credited   TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (farmer_id) REFERENCES users(id),
  INDEX idx_order_items_farmer (farmer_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PAYMENTS  (Razorpay + COD tracking)
-- ---------------------------------------------------------------------
CREATE TABLE payments (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  order_id              INT NOT NULL,
  razorpay_order_id     VARCHAR(100) NULL,
  razorpay_payment_id   VARCHAR(100) NULL,
  razorpay_signature    VARCHAR(255) NULL,
  amount                DECIMAL(10,2) NOT NULL,
  method                ENUM('COD','RAZORPAY') NOT NULL,
  status                ENUM('created','pending','success','failed','refunded') NOT NULL DEFAULT 'pending',
  failure_reason        VARCHAR(255) NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- REFUNDS
-- ---------------------------------------------------------------------
CREATE TABLE refunds (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT NOT NULL,
  payment_id        INT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  reason            VARCHAR(255) NOT NULL,
  status            ENUM('requested','processing','completed','rejected') NOT NULL DEFAULT 'requested',
  processed_by      INT NULL COMMENT 'admin user id',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES payments(id),
  FOREIGN KEY (processed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- WALLETS  (Farmer earnings, after 2% platform fee)
-- ---------------------------------------------------------------------
CREATE TABLE wallets (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  farmer_id         INT NOT NULL UNIQUE,
  balance           DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_earned      DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_withdrawn   DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE wallet_transactions (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  wallet_id         INT NOT NULL,
  order_item_id     INT NULL,
  type              ENUM('credit','debit','withdrawal','adjustment') NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  description       VARCHAR(255),
  balance_after     DECIMAL(10,2) NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- WITHDRAWALS  (Farmer requests payout to bank account)
-- ---------------------------------------------------------------------
CREATE TABLE withdrawals (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  farmer_id         INT NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  bank_account_number VARCHAR(30) NOT NULL,
  bank_ifsc         VARCHAR(15) NOT NULL,
  status            ENUM('requested','approved','processed','rejected') NOT NULL DEFAULT 'requested',
  admin_remark      VARCHAR(255) NULL,
  processed_by      INT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (processed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- PAYMENT ISSUE TICKETS  (customer/farmer raised, admin resolves)
-- ---------------------------------------------------------------------
CREATE TABLE payment_issues (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  raised_by         INT NOT NULL,
  order_id          INT NULL,
  subject           VARCHAR(150) NOT NULL,
  description       TEXT NOT NULL,
  status            ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  admin_response    TEXT NULL,
  resolved_by       INT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Seed default admin (password: Admin@12345 -- CHANGE AFTER FIRST LOGIN)
-- Hash below corresponds to bcrypt('Admin@12345', 12) — regenerate via
-- the /api/auth/seed-admin route or scripts/seedAdmin.js in production.
-- ---------------------------------------------------------------------
-- INSERT INTO users (name, email, phone, password_hash, role, is_verified)
-- VALUES ('Super Admin', 'admin@krushisetu.com', '9999999999', '<bcrypt-hash>', 'admin', 1);

-- Seed a few categories
INSERT INTO categories (name, description) VALUES
('Vegetables', 'Fresh vegetables'),
('Fruits', 'Fresh fruits'),
('Grains & Pulses', 'Rice, wheat, dals'),
('Dairy', 'Milk and milk products'),
('Spices', 'Spices and condiments');
