const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { logger } = require('../utils/logger');

const { runLowStockScan, runExpiryScan, runOutOfStockScan, runExpiredBatchSweep } = require('./handlers/inventory');
const { runDailySummary, runWeeklyReport, runPendingReminder, runAdminDigest, runRefillReminder } = require('./handlers/notifications');
const { runInsights, runForecast, runExpiryRisk } = require('./handlers/ai');
const { runSubscriptionExpiring, runSubscriptionExpired, runSubscriptionPastDue } = require('./handlers/subscription');
const { runRetryWebhooks, runCleanupSessions, runCleanupNotifications, runDatabaseBackup, runBackupRetention } = require('./handlers/maintenance');

let workers = [];

function startWorkers() {
  const connection = redisConnection();
  if (!connection) {
    logger.warn('workers: redis disabled, skipping');
    return [];
  }

  const opts = { connection, concurrency: 3 };

  workers = [
    new Worker('inventory', async (job) => {
      switch (job.name) {
        case 'low-stock': return runLowStockScan();
        case 'out-of-stock': return runOutOfStockScan();
        case 'expiry': return runExpiryScan();
        case 'expired-batch-sweep': return runExpiredBatchSweep();
        default: return null;
      }
    }, opts),

    new Worker('notifications', async (job) => {
      switch (job.name) {
        case 'daily-summary': return runDailySummary();
        case 'weekly-report': return runWeeklyReport();
        case 'pending-reminder': return runPendingReminder();
        case 'admin-digest': return runAdminDigest();
        case 'refill-reminder': return runRefillReminder();
        default: return null;
      }
    }, opts),

    new Worker('ai', async (job) => {
      switch (job.name) {
        case 'insights': return runInsights();
        case 'forecast': return runForecast();
        case 'expiry-risk': return runExpiryRisk();
        default: return null;
      }
    }, opts),

    new Worker('lifecycle', async (job) => {
      switch (job.name) {
        case 'expiring': return runSubscriptionExpiring();
        case 'expired': return runSubscriptionExpired();
        case 'past-due': return runSubscriptionPastDue();
        default: return null;
      }
    }, opts),

    new Worker('webhooks', async (job) => {
      switch (job.name) {
        case 'retry': return runRetryWebhooks();
        default: return null;
      }
    }, opts),

    new Worker('cleanup', async (job) => {
      switch (job.name) {
        case 'sessions': return runCleanupSessions();
        case 'notifications': return runCleanupNotifications();
        default: return null;
      }
    }, opts),

    new Worker('backups', async (job) => {
      switch (job.name) {
        case 'run': return runDatabaseBackup(job.data);
        case 'prune': return runBackupRetention();
        default: return null;
      }
    }, opts),

    new Worker('reports', async () => null, opts),
  ];

  workers.forEach((w) => {
    w.on('failed', (job, err) => {
      logger.error({ queue: w.name, job: job?.name, err: err?.message }, 'worker job failed');
    });
    w.on('completed', (job) => {
      logger.info({ queue: w.name, job: job?.name }, 'worker job completed');
    });
  });

  return workers;
}

async function stopWorkers() {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}

module.exports = { startWorkers, stopWorkers };