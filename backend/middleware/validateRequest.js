const { validationResult } = require('express-validator');
const { error } = require('../utils/apiResponse');

/**
 * Runs after an array of express-validator checks. If any check failed,
 * responds with 422 and a field-level error list; otherwise calls next().
 */
const validateRequest = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const formatted = result.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    return error(res, 422, 'Validation failed.', formatted);
  }
  next();
};

module.exports = validateRequest;
