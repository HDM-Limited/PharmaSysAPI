const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const Plan = require('../models/admin/Plan');
const User = require('../models/client/User');
const Sale = require('../models/client/Sale');
const AppNotification = require('../models/client/AppNotification');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { runAsTenant } = require('../models/plugins/context');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function run() {
  const start = startOfToday();
  const tenants = await Tenant.find({ status: 'active' })
    .select('_id name planCode')
    .lean();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenant of tenants) {
    try {
      const result = await runAsTenant({ tenantId: String(tenant._id) }, async () => {
        const already = await AppNotification.findOne({
          tenantId: tenant._id,
          type: 'info',
          title: 'Daily summary',
          createdAt: { $gte: start },
        })
          .select('_id')
          .lean();

        if (already) {
          return { sent: 0, skipped: 1 };
        }

        const owners = await User.find({
          tenantId: tenant._id,
          role: 'owner',
          status: 'active',
        })
          .select('_id email fullName')
          .lean();

        if (!owners.length) return { sent: 0, skipped: 0 };

        const [salesAgg, topDrugs] = await Promise.all([
          Sale.aggregate([
            {
              $match: {
                tenantId: tenant._id,
                createdAt: { $gte: start },
                status: { $ne: 'voided' },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$grandTotal' },
                count: { $sum: 1 },
              },
            },
          ]),
          Sale.aggregate([
            {
              $match: {
                tenantId: tenant._id,
                createdAt: { $gte: start },
                status: { $ne: 'voided' },
              },
            },
            { $unwind: '$items' },
            { $group: { _id: '$items.name', qty: { $sum: '$items.qty' } } },
            { $sort: { qty: -1 } },
            { $limit: 5 },
          ]),
        ]);

        const total = salesAgg[0]?.total || 0;
        const count = salesAgg[0]?.count || 0;
        const avgBasket = count ? total / count : 0;

        const plan = await Plan.findOne({ code: tenant.planCode }).lean();
        const currency = plan?.price?.currency || 'KES';
        const top = topDrugs.map((t) => ({ name: t._id, qty: t.qty }));

        let innerSent = 0;

        for (const owner of owners) {
          notificationService
            .create({
              tenantId: tenant._id,
              userId: owner._id,
              type: 'info',
              title: 'Daily summary',
              body: `${currency} ${Math.round(total)} · ${count} sales`,
              link: '/app/dashboard',
              meta: { total, count, currency },
            })
            .catch(() => {});

          if (owner.email) {
            emailService
              .sendDailySummary({
                tenantId: tenant._id,
                to: owner.email,
                businessName: tenant.name,
                date: start.toLocaleDateString('en-KE', { dateStyle: 'medium' }),
                totalSales: total,
                totalTransactions: count,
                avgBasket,
                currency,
                topProducts: top,
                insightsUrl: `${env.appUrl}/app/ai/insights`,
              })
              .catch(() => {});
            innerSent++;
          }
        }

        return { sent: innerSent, skipped: 0 };
      });

      sent += result.sent;
      skipped += result.skipped;
    } catch (err) {
      failed++;
      logger.warn(
        { err: err.message, tenantId: String(tenant._id) },
        'daily metrics failed for tenant'
      );
    }
  }

  logger.info(
    { sent, skipped, failed, tenants: tenants.length },
    'daily metrics scan complete'
  );
  return { sent, skipped, failed };
}

function start() {
  task = cron.schedule(
    '0 21 * * *',
    () => {
      run().catch((err) =>
        logger.error({ err: err.message }, 'daily metrics failed')
      );
    },
    { timezone: TZ }
  );
  logger.info('daily-metrics scheduler started (daily, deduped)');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'dailyMetrics', start, stop, run };