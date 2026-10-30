require('./config/env');
const app = require('./app');
const { testConnection } = require('./config/db');

const PORT = process.env.PORT || 5000;

(async () => {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`KrushiSetu API listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
})();

// Guard rails so an unexpected rejection doesn't silently crash MySQL
// connections mid-transaction without any log trail.
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});
