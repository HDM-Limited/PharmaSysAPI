const cron = require('node-cron');
const { lifecycleQueue } = require('./queues');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

function start() {
  if (!lifecycleQueue) return;
  cron.schedule('0 8 * * *', () => lifecycleQueue.add('expiring', {}), { timezone: TZ });
  cron.schedule('5 0 * * *', () => lifecycleQueue.add('expired', {}), { timezone: TZ });
  cron.schedule('30 8 * * *', () => lifecycleQueue.add('past-due', {}), { timezone: TZ });
  logger.info('subscription scheduler started');
}

module.exports = { start };