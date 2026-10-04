const cron = require('node-cron');
const { notificationsQueue } = require('./queues');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

function start() {
  if (!notificationsQueue) return;
  cron.schedule('0 21 * * *', () => notificationsQueue.add('daily-summary', {}), { timezone: TZ });
  cron.schedule('0 7 * * 1', () => notificationsQueue.add('weekly-report', {}), { timezone: TZ });
  cron.schedule('0 10 * * *', () => notificationsQueue.add('pending-reminder', {}), { timezone: TZ });
  cron.schedule('0 8 * * *', () => notificationsQueue.add('admin-digest', {}), { timezone: TZ });
  cron.schedule('0 9 * * *', () => notificationsQueue.add('refill-reminder', {}), { timezone: TZ });
  logger.info('notification scheduler started');
}

module.exports = { start };