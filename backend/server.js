
require('./config/env');

const app = require('./app');
const { testConnection } = require('./config/db');

const PORT = process.env.PORT || 5000;

// Start KrushiSetu server
async function startServer() {
  try {
    // Test MySQL connection
    await testConnection();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`KrushiSetu API running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error('KrushiSetu startup failed:', error.message);
    process.exit(1);
  }
}

// Handle unexpected errors
process.on('unhandledRejection', (error) => {
  console.error('UNHANDLED REJECTION:', error);
});

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

// Start application
startServer();
