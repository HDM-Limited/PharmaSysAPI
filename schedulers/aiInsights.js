const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const aiService = require('../services/aiService');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

async function run() {
  const tenants = await Tenant.find({ status: 'active' }).select('_id name').lean();
  let generated = 0;
  let failed = 0;

  for (const tenant of tenants) {
    try {
      await aiService.generateWeeklyInsights({ tenantId: tenant._id, force: true });
      await aiService.generateStockForecast({ tenantId: tenant._id, force: true });
      await aiService.generateExpiryRisk({ tenantId: tenant._id, force: true });
      generated++;
    } catch (err) {
      failed++;
      logger.warn({ err: err.message, tenantId: String(tenant._id) }, 'ai insights generation failed');
    }
  }

  logger.info({ generated, failed, total: tenants.length }, 'ai insights scan complete');
  return { generated, failed };
}

function start() {
  task = cron.schedule('0 3 * * *', () => {
    run().catch((err) => logger.error({ err: err.message }, 'ai insights failed'));
  }, { timezone: TZ });
  logger.info('ai-insights scheduler started');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'aiInsights', start, stop, run };