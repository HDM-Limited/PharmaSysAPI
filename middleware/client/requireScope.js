const { ApiError } = require('../../utils/apiError');

function requireScope(scope) {
  return (req, _res, next) => {
    if (!req.scope) return next(ApiError.unauthorized());
    if (req.scope !== scope) {
      return next(ApiError.forbidden('SCOPE_MISMATCH', `Requires scope: ${scope}`));
    }
    next();
  };
}

module.exports = requireScope;