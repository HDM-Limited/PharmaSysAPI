const AdminAction = require('../../models/admin/AdminAction');
const { logger } = require('../../utils/logger');

function logAdminAction(req, res, next) {
  const skip = !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (skip || !req.admin) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400) return;

    const action = `${req.method} ${req.baseUrl}${req.path}`.toLowerCase();

    AdminAction.create({
      adminId: req.admin.id,
      tenantId: req.params?.tenantId || req.body?.tenantId || null,
      action,
      metadata: {
        params: req.params || {},
        query: req.query || {},
      },
      ip: req.ip,
    }).catch((err) => logger.warn({ err: err.message }, 'admin action log failed'));
  });

  next();
}

module.exports = logAdminAction;