const { logger } = require('../utils/logger');

const aiInsights = require('./aiInsights');
const autoBackup = require('./autoBackup');
const dailyMetrics = require('./dailyMetrics');
const lowStockAlerts = require('./lowStockAlerts');
const overdueInvoices = require('./overdueInvoices');
const pendingExpiry = require('./pendingExpiry');

const SCHEDULERS = [
  aiInsights,
  autoBackup,
  dailyMetrics,
  lowStockAlerts,
  overdueInvoices,
  pendingExpiry,
];

function startSchedulers() {
  if (process.env.SCHEDULERS_ENABLED === 'false') {
    logger.warn('schedulers disabled via SCHEDULERS_ENABLED=false');
    return;
  }

  for (const scheduler of SCHEDULERS) {
    try {
      scheduler.start();
    } catch (err) {
      logger.error({ err: err.message, scheduler: scheduler.name }, 'scheduler failed to start');
    }
  }

  logger.info('schedulers started');
}

function stopSchedulers() {
  for (const scheduler of SCHEDULERS) {
    try {
      scheduler.stop?.();
    } catch (err) {
      logger.warn({ err: err.message, scheduler: scheduler.name }, 'scheduler stop failed');
    }
  }
}

module.exports = { startSchedulers, stopSchedulers };