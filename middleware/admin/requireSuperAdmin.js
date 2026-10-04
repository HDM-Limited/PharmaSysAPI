const { ApiError } = require('../../utils/apiError');

function requireSuperAdmin(req, _res, next) {
  if (!req.admin) return next(ApiError.unauthorized());
  if (req.admin.role !== 'super_admin') {
    return next(ApiError.forbidden('NOT_SUPER_ADMIN', 'Super admin required'));
  }
  next();
}

module.exports = requireSuperAdmin;