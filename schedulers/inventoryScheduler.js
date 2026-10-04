const cron = require('node-cron');
const { inventoryQueue } = require('./queues');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

function start() {
  if (!inventoryQueue) return;
  cron.schedule('*/15 * * * *', () => inventoryQueue.add('low-stock', {}), { timezone: TZ });
  cron.schedule('*/30 * * * *', () => inventoryQueue.add('out-of-stock', {}), { timezone: TZ });
  cron.schedule('0 6 * * *', () => inventoryQueue.add('expiry', {}), { timezone: TZ });
  cron.schedule('30 0 * * *', () => inventoryQueue.add('expired-batch-sweep', {}), { timezone: TZ });
  logger.info('inventory scheduler started');
}

module.exports = { start };