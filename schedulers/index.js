const { startWorkers, stopWorkers } = require('./workers');
const subscriptionScheduler = require('./subscriptionScheduler');
const inventoryScheduler = require('./inventoryScheduler');
const notificationScheduler = require('./notificationScheduler');
const aiScheduler = require('./aiScheduler');
const maintenanceScheduler = require('./maintenanceScheduler');
const { logger } = require('../utils/logger');

function startSchedulers() {
  try {
    subscriptionScheduler.start();
    inventoryScheduler.start();
    notificationScheduler.start();
    aiScheduler.start();
    maintenanceScheduler.start();
    startWorkers();
    logger.info('schedulers + workers started');
  } catch (err) {
    logger.error({ err: err.message }, 'schedulers failed to start');
  }
}

async function stopSchedulers() {
  await stopWorkers();
}

module.exports = { startSchedulers, stopSchedulers };