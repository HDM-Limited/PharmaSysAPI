const { logger } = require('../../utils/logger');

function requestLogger(req, res, next) {
  const started = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - started;
    const payload = {
      id: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
    };
    if (req.tenantId) payload.tenantId = String(req.tenantId);
    if (req.user?._id) payload.userId = String(req.user._id);
    if (req.admin?.id) payload.adminId = String(req.admin.id);

    if (res.statusCode >= 500) logger.error(payload, 'request');
    else if (res.statusCode >= 400) logger.warn(payload, 'request');
    else logger.info(payload, 'request');
  });

  next();
}

module.exports = requestLogger;