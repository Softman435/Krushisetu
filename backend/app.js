const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const xss = require('xss-clean');
require('./config/env');

const { apiLimiter } = require('./middleware/rateLimiters');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const addressRoutes = require('./routes/addressRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supportRoutes = require('./routes/supportRoutes');
const { razorpayWebhook } = require('./controllers/paymentController');

const app = express();
const configuredClientOrigin = process.env.CLIENT_URL
  ? new URL(process.env.CLIENT_URL).origin
  : null;

function isLocalDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

// ---- Security & core middleware ----
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        origin === configuredClientOrigin ||
        (process.env.NODE_ENV !== 'production' && isLocalDevelopmentOrigin(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS.'));
    },
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());

// Razorpay webhook MUST be registered before the global express.json()
// parser, using express.raw(), because signature verification needs the
// exact raw request bytes. Defining it here (rather than only inside
// paymentRoutes) guarantees it runs before body-parsing middleware
// consumes the stream — otherwise the raw buffer would already be gone
// by the time a route-level raw() middleware tried to read it.
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(xss()); // sanitize req.body/query/params against stored/reflected XSS

app.use('/api', apiLimiter);

// ---- Health check ----
app.get('/api/health', (req, res) => res.json({ success: true, message: 'KrushiSetu API is running.' }));

// ---- Routes ----
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);

// ---- 404 + error handling (must be last) ----
app.use(notFound);
app.use(errorHandler);

module.exports = app;
