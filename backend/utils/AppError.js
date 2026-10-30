// A known, "operational" error we can throw anywhere in the app and
// trust the global error handler to turn into a clean JSON response
// with the right HTTP status code (instead of a generic 500).
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
