const cron = require('node-cron');
const backupService = require('../services/backupService');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

async function run() {
  try {
    const backup = await backupService.createBackup({ type: 'auto' });
    logger.info({ filename: backup.filename, bytes: backup.sizeBytes }, 'auto backup complete');
    return { filename: backup.filename };
  } catch (err) {
    logger.error({ err: err.message }, 'auto backup failed');
    throw err;
  }
}

async function prune() {
  try {
    const result = await backupService.prune();
    logger.info({ deleted: result.deleted }, 'backup prune complete');
    return result;
  } catch (err) {
    logger.warn({ err: err.message }, 'backup prune failed');
    return { deleted: 0 };
  }
}

function start() {
  task = cron.schedule('0 1 * * *', () => {
    run().catch(() => {});
  }, { timezone: TZ });

  cron.schedule('0 2 * * *', () => {
    prune().catch(() => {});
  }, { timezone: TZ });

  logger.info('auto-backup scheduler started');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'autoBackup', start, stop, run, prune };