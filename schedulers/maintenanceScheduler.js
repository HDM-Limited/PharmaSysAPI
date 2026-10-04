const cron = require('node-cron');
const { webhookQueue, cleanupQueue, backupsQueue } = require('./queues');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

function start() {
  if (webhookQueue) {
    cron.schedule('*/10 * * * *', () => webhookQueue.add('retry', {}), { timezone: TZ });
  }
  if (cleanupQueue) {
    cron.schedule('0 * * * *', () => cleanupQueue.add('sessions', {}), { timezone: TZ });
    cron.schedule('0 2 * * *', () => cleanupQueue.add('notifications', {}), { timezone: TZ });
  }
  if (backupsQueue) {
    cron.schedule('0 1 * * *', () => backupsQueue.add('run', { type: 'auto' }), { timezone: TZ });
    cron.schedule('0 2 * * *', () => backupsQueue.add('prune', {}), { timezone: TZ });
  }
  logger.info('maintenance scheduler started');
}

module.exports = { start };