const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const { AiInsight } = require('../models/client/Ai');
const aiService = require('../services/aiService');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function run() {
  const tenants = await Tenant.find({ status: 'active' })
    .select('_id name')
    .lean();

  const today = startOfToday();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenant of tenants) {
    // Dedupe: skip if any insight was generated today for this tenant
    const recent = await AiInsight.findOne({
      __allowGlobal: true,
      tenantId: tenant._id,
      generatedAt: { $gte: today },
    })
      .select('_id')
      .lean();

    if (recent) {
      skipped++;
      continue;
    }

    try {
      await aiService.generateWeeklyInsights({ tenantId: tenant._id, force: true });
      await aiService.generateStockForecast({ tenantId: tenant._id, force: true });
      await aiService.generateExpiryRisk({ tenantId: tenant._id, force: true });
      generated++;
    } catch (err) {
      failed++;
      logger.warn(
        { err: err.message, tenantId: String(tenant._id) },
        'ai insights generation failed'
      );
    }
  }

  logger.info(
    { generated, skipped, failed, total: tenants.length },
    'ai insights scan complete'
  );
  return { generated, skipped, failed };
}

function start() {
  task = cron.schedule(
    '0 3 * * *',
    () => {
      run().catch((err) =>
        logger.error({ err: err.message }, 'ai insights failed')
      );
    },
    { timezone: TZ }
  );
  logger.info('ai-insights scheduler started (daily, deduped)');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'aiInsights', start, stop, run };