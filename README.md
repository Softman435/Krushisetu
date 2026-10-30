# KrushiSetu — Farmer-to-Customer Agricultural Marketplace

KrushiSetu connects farmers directly with customers, cutting out middlemen.
Farmers list produce at Grade A/B/C pricing, customers browse and order with
COD or Razorpay, and an Admin dashboard oversees the whole marketplace.

## Tech Stack
- **Frontend:** HTML, CSS, Vanilla JavaScript (no framework/build step)
- **Backend:** Node.js, Express.js
- **Database:** MySQL (mysql2, parameterized queries throughout)
- **Auth:** JWT (short-lived access token + rotating httpOnly refresh cookie), bcrypt password hashing
- **Payments:** Razorpay (server-side signature verification) + Cash on Delivery

---

## Project Structure

```
krushisetu/
├── backend/
│   ├── config/db.js              MySQL connection pool
│   ├── controllers/              Route handlers (business logic)
│   ├── middleware/                auth, validation, rate-limiting, error handling
│   ├── routes/                   Express routers, one per resource
│   ├── validators/               express-validator rule sets
│   ├── utils/                    JWT helpers, AppError, asyncHandler, response shape
│   ├── database/schema.sql       Full MySQL schema + seed categories
│   ├── scripts/seedAdmin.js      One-time script to create the first Admin
│   ├── app.js                    Express app + middleware wiring
│   ├── server.js                 Entry point
│   ├── package.json
│   └── .env.example              Copy to .env and fill in real values
└── frontend/
    ├── css/style.css
    ├── js/api.js                 Fetch wrapper with auto token refresh
    ├── js/navbar.js              Role-aware navigation bar
    ├── index.html                Public marketplace (browse/filter/search)
    ├── product.html              Product detail + add to cart
    ├── login.html / register.html
    ├── cart.html                 Cart + checkout (COD/Razorpay)
    ├── addresses.html / orders.html         (customer)
    ├── farmer-dashboard.html                (farmer: manage products)
    ├── farmer-orders.html / farmer-wallet.html
    └── admin-dashboard.html                 (tabbed admin console)
```

---

## Setup

### 1. Database
```bash
mysql -u root -p < backend/database/schema.sql
```
This creates the `krushisetu` database, all tables, and a handful of seed categories.

### 2. Backend
```bash
cd backend
cp .env.example .env
# Edit .env: DB credentials, JWT secrets, Razorpay keys, etc.
npm install
npm run seed:admin      # creates the first Admin account from DEFAULT_ADMIN_* in .env
npm run dev             # or: npm start
```
The API runs on `http://localhost:5000` by default. Health check: `GET /api/health`.
For online payments, set a matching Razorpay Key ID and Key Secret from the same
Razorpay account in `backend/.env` (use test-mode keys while developing).
Placeholder keys cannot create payments; restart the backend after changing keys.
The backend loads this `.env` file relative to its own directory, so it works
whether you start Node from the project root or the `backend` directory.
In development, the API accepts frontend origins on `localhost`, `127.0.0.1`,
and `::1` on any port. In production, set `CLIENT_URL` to the exact frontend
origin to allow.

**Generate strong JWT secrets** before going anywhere near production:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Frontend
The frontend is static HTML/CSS/JS — no build step. Serve it with any static
server, e.g.:
```bash
cd frontend
npx serve .
# or just open index.html directly, then update API_BASE_URL in js/api.js
# if your backend isn't on http://localhost:5000
```

---

## Authentication & Security — what's implemented and why

| Concern | Implementation |
|---|---|
| Password storage | `bcrypt` with configurable salt rounds (default 12) — plaintext passwords are never stored or logged |
| Session tokens | Short-lived JWT **access token** (15 min default) returned to the client; long-lived **refresh token** (7 days) stored only as an `httpOnly`, `sameSite=strict` cookie so client-side JS can never read or leak it |
| Refresh token theft mitigation | Only a bcrypt **hash** of the refresh token is stored in the DB; every refresh rotates the token; a hash mismatch on refresh invalidates the whole session |
| Brute-force login protection | Account lockout after `MAX_LOGIN_ATTEMPTS` (default 5) failed attempts for `LOCK_TIME_MINUTES` (default 15); a stricter `express-rate-limit` window on `/auth/*` routes on top of that |
| Input validation | Every mutating endpoint runs through `express-validator` rules (`validators/`) — type, length, format (email, 10-digit Indian mobile, 6-digit pincode, IFSC pattern), and a strong password policy (8+ chars, upper/lower/digit/symbol) — before it reaches a controller |
| Authorization | `protect` middleware verifies the JWT AND re-checks the user's active/lock status in the DB on every request; `authorize(...roles)` enforces Farmer/Customer/Admin boundaries per route; ownership checks (e.g. a farmer can only edit **their own** products) are enforced in controllers, not just the client |
| Injection protection | 100% parameterized queries via `mysql2`'s named placeholders — no string-concatenated SQL anywhere |
| XSS protection | `xss-clean` sanitizes `req.body`/`query`/`params`; `helmet` sets standard security headers |
| Payment integrity | Razorpay payments are confirmed **only** after the server independently recomputes the HMAC-SHA256 signature and compares it with `crypto.timingSafeEqual` — the client's "success" callback is never trusted on its own |
| Overselling protection | Checkout runs inside a DB transaction with `SELECT ... FOR UPDATE` row locks on both the cart and the product stock rows |
| Consistent error handling | A central error handler returns a uniform JSON shape and never leaks stack traces outside development mode |

**Still recommended for a production deployment** (kept out of scope here to keep the codebase focused): email/phone OTP verification, HTTPS/TLS termination, a WAF, structured audit logging, and moving Razorpay webhook secret handling into a secrets manager.

---

## Core Business Rules Implemented
- Products always start as **pending** and only appear in the public marketplace once an Admin approves them.
- Each product can price **Grade A / B / C independently**, with independent stock quantities per grade.
- The marketplace lists products only when at least one priced grade has stock; buying validates grade availability and quantity (up to two decimal places) in both the frontend and API.
- Checkout locks in price and deducts grade-specific stock atomically; cancelling before shipment restores stock.
- On **delivery** of an order item, the farmer's wallet is credited with `line_total − 2% platform fee` (`PLATFORM_FEE_PERCENT` in `.env`).
- Withdrawal requests debit the wallet immediately (held) and are only finalized as `processed` by an Admin; a `rejected` request refunds the wallet.
- Delivery charges are configurable per category (`base_charge` + `per_kg_charge`) by the Admin and computed automatically at checkout.

---

## API Overview

All endpoints are prefixed with `/api`. Full route lists live in `backend/routes/`.

- `POST /auth/register/farmer`, `POST /auth/register/customer`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/change-password`
- `GET /products`, `GET /products/:id`, `POST /products`, `PUT /products/:id`, `DELETE /products/:id`, `GET /products/farmer/mine`
- `GET /categories`, admin CRUD under `/categories`
- `GET/POST/PUT/DELETE /addresses`
- `GET/POST/PUT/DELETE /cart`
- `POST /orders/checkout`, `GET /orders/my`, `GET /orders/:id`, `PATCH /orders/:id/cancel`, `GET /orders/farmer/mine`, `PATCH /orders/items/:itemId/status`
- `POST /payments/razorpay/create-order`, `POST /payments/razorpay/verify`, `POST /payments/razorpay/webhook`
- `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/withdraw`, `GET /wallet/withdrawals`
- `GET /admin/dashboard/summary`, plus farmers/customers/products/categories/delivery-charges/orders/refunds/wallets/withdrawals/payment-issues management under `/admin/*`
- `GET/POST /support` — payment/order issue tickets raised by customers or farmers

---

## Notes on This Build
This is a complete, runnable reference implementation covering the full spec:
role-based auth, admin approval workflow, grade-based pricing, cart/checkout,
COD + Razorpay, wallet with platform fee, withdrawals, delivery-charge config,
refunds, and an admin console. Swap in real product images/hosting, wire up
email/SMS notifications, and run a security review before taking this to
production traffic.
#   K r u s h i s e t u  
 