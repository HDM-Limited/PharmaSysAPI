const { ApiError } = require('../../utils/apiError');

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(ApiError.badRequest('VALIDATION_ERROR', 'Invalid input', details));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };