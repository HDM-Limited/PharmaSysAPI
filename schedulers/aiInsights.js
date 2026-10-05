const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const { AiInsight } = require('../models/client/Ai');
const aiService = require('../services/aiService');
const { runAsTenant } = require('../models/plugins/context');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function run() {
  const today = startOfToday();
  const tenants = await Tenant.find({ status: 'active' })
    .select('_id name')
    .lean();

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenant of tenants) {
    try {
      const result = await runAsTenant({ tenantId: String(tenant._id) }, async () => {
        const recent = await AiInsight.findOne({
          tenantId: tenant._id,
          generatedAt: { $gte: today },
        })
          .select('_id')
          .lean();

        if (recent) return { generated: 0, skipped: 1 };

        await aiService.generateWeeklyInsights({ tenantId: tenant._id, force: true });
        await aiService.generateStockForecast({ tenantId: tenant._id, force: true });
        await aiService.generateExpiryRisk({ tenantId: tenant._id, force: true });

        return { generated: 1, skipped: 0 };
      });

      generated += result.generated;
      skipped += result.skipped;
    } catch (err) {
      failed++;
      logger.warn(
        { err: err.message, tenantId: String(tenant._id) },
        'ai insights generation failed for tenant'
      );
    }
  }

  logger.info(
    { generated, skipped, failed, tenants: tenants.length },
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