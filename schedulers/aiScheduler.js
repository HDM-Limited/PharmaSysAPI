const cron = require('node-cron');
const { aiQueue } = require('./queues');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

function start() {
  if (!aiQueue) return;
  cron.schedule('0 3 * * *', () => aiQueue.add('insights', {}), { timezone: TZ });
  cron.schedule('30 3 * * *', () => aiQueue.add('forecast', {}), { timezone: TZ });
  cron.schedule('0 4 * * *', () => aiQueue.add('expiry-risk', {}), { timezone: TZ });
  logger.info('ai scheduler started');
}

module.exports = { start };