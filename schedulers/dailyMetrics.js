const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const User = require('../models/client/User');
const Sale = require('../models/client/Sale');
const Plan = require('../models/admin/Plan');
const AppNotification = require('../models/client/AppNotification');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
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

  for (const tenant of tenants) {
    // Dedupe: one daily summary per tenant per day
    const already = await AppNotification.findOne({
      __allowGlobal: true,
      tenantId: tenant._id,
      type: 'info',
      title: 'Daily summary',
      createdAt: { $gte: start },
    })
      .select('_id')
      .lean();

    if (already) {
      skipped++;
      continue;
    }

    const owners = await User.find({
      __allowGlobal: true,
      tenantId: tenant._id,
      role: 'owner',
      status: 'active',
    })
      .select('_id email fullName')
      .lean();

    if (!owners.length) continue;

    const [salesAgg, topDrugs] = await Promise.all([
      Sale.aggregate([
        {
          $match: {
            tenantId: tenant._id,
            createdAt: { $gte: start },
            status: { $ne: 'voided' },
          },
        },
        { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
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
        sent++;
      }
    }
  }

  logger.info({ sent, skipped }, 'daily metrics scan complete');
  return { sent, skipped };
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