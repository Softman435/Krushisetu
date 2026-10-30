// Wraps an async route/controller so thrown errors are forwarded to
// Express's error-handling middleware instead of crashing the process
// or requiring a try/catch block in every controller.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
