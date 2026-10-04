const AdminAction = require('../models/admin/AdminAction');
const { logger } = require('../utils/logger');

async function log({ adminId, tenantId = null, action, reason = null, metadata = {}, ip = null }) {
  try {
    return await AdminAction.create({
      adminId,
      tenantId,
      action,
      reason,
      metadata,
      ip,
    });
  } catch (err) {
    logger.warn({ err: err.message, action }, 'admin action log failed');
    return null;
  }
}

async function list({ filter = {}, page = 1, limit = 20, skip = 0 }) {
  const [items, total] = await Promise.all([
    AdminAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminAction.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

module.exports = { log, list };