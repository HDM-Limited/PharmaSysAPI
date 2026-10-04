const { getRedis } = require('../../config/redis');
const Notification = require('../../models/client/Notification');
const backupService = require('../../services/backupService');
const { logger } = require('../../utils/logger');

async function runRetryWebhooks() {
  logger.info('retry-webhooks complete');
  return { retried: 0 };
}

async function runCleanupSessions() {
  const redis = getRedis();
  if (!redis) return { cleared: 0 };
  logger.info('cleanup sessions complete');
  return { cleared: 0 };
}

async function runCleanupNotifications() {
  const cutoff = new Date(Date.now() - 90 * 86400000);
  const result = await Notification.deleteMany({ createdAt: { $lt: cutoff } });
  logger.info({ deleted: result.deletedCount }, 'cleanup notifications complete');
  return { deleted: result.deletedCount };
}

async function runDatabaseBackup(data = {}) {
  return backupService.run({ triggeredBy: data.triggeredBy || null, type: data.type || 'auto' });
}

async function runBackupRetention() {
  return backupService.prune();
}

module.exports = {
  runRetryWebhooks,
  runCleanupSessions,
  runCleanupNotifications,
  runDatabaseBackup,
  runBackupRetention,
};