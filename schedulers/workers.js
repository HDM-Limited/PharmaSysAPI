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

  const defaultOpts = { connection, concurrency: 3 };
  const criticalOpts = {
    connection,
    concurrency: 1,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  };

  workers = [
    new Worker('inventory', async (job) => {
      switch (job.name) {
        case 'low-stock': return runLowStockScan();
        case 'out-of-stock': return runOutOfStockScan();
        case 'expiry': return runExpiryScan();
        case 'expired-batch-sweep': return runExpiredBatchSweep();
        default: return null;
      }
    }, defaultOpts),

    new Worker('notifications', async (job) => {
      switch (job.name) {
        case 'daily-summary': return runDailySummary();
        case 'weekly-report': return runWeeklyReport();
        case 'pending-reminder': return runPendingReminder();
        case 'admin-digest': return runAdminDigest();
        case 'refill-reminder': return runRefillReminder();
        default: return null;
      }
    }, defaultOpts),

    new Worker('ai', async (job) => {
      switch (job.name) {
        case 'insights': return runInsights();
        case 'forecast': return runForecast();
        case 'expiry-risk': return runExpiryRisk();
        default: return null;
      }
    }, defaultOpts),

    // ── Strict: lifecycle retries + single concurrency ──
    new Worker('lifecycle', async (job) => {
      switch (job.name) {
        case 'expiring': return runSubscriptionExpiring();
        case 'expired': return runSubscriptionExpired();
        case 'past-due': return runSubscriptionPastDue();
        default: return null;
      }
    }, criticalOpts),

    new Worker('webhooks', async (job) => {
      switch (job.name) {
        case 'retry': return runRetryWebhooks();
        default: return null;
      }
    }, { ...defaultOpts, attempts: 5, backoff: { type: 'exponential', delay: 2000 } }),

    new Worker('cleanup', async (job) => {
      switch (job.name) {
        case 'sessions': return runCleanupSessions();
        case 'notifications': return runCleanupNotifications();
        default: return null;
      }
    }, defaultOpts),

    new Worker('backups', async (job) => {
      switch (job.name) {
        case 'run': return runDatabaseBackup(job.data);
        case 'prune': return runBackupRetention();
        default: return null;
      }
    }, { ...defaultOpts, concurrency: 1, attempts: 2 }),

    new Worker('reports', async () => null, defaultOpts),
  ];

  workers.forEach((w) => {
    w.on('failed', (job, err) => {
      logger.error(
        { queue: w.name, job: job?.name, attempts: job?.attemptsMade, err: err?.message },
        'worker job failed'
      );
    });
    w.on('completed', (job) => {
      logger.info({ queue: w.name, job: job?.name }, 'worker job completed');
    });
    w.on('error', (err) => {
      logger.error({ queue: w.name, err: err.message }, 'worker error');
    });
  });

  return workers;
}

async function stopWorkers() {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}

module.exports = { startWorkers, stopWorkers };