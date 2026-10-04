const { Queue } = require('bullmq');
const { redisConnection } = require('../config/redis');

const connection = redisConnection();

function makeQueue(name) {
  if (!connection) return null;
  return new Queue(name, { connection });
}

const notificationsQueue = makeQueue('notifications');
const inventoryQueue = makeQueue('inventory');
const reportsQueue = makeQueue('reports');
const aiQueue = makeQueue('ai');
const webhookQueue = makeQueue('webhooks');
const cleanupQueue = makeQueue('cleanup');
const backupsQueue = makeQueue('backups');
const lifecycleQueue = makeQueue('lifecycle');

module.exports = {
  notificationsQueue,
  inventoryQueue,
  reportsQueue,
  aiQueue,
  webhookQueue,
  cleanupQueue,
  backupsQueue,
  lifecycleQueue,
};