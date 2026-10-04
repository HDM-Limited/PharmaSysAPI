const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const Branch = require('../models/client/Branch');
const { Drug, Batch } = require('../models/client/Inventory');
const User = require('../models/client/User');
const AppNotification = require('../models/client/AppNotification');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function run() {
  const tenants = await Tenant.find({ status: 'active' }).select('_id name').lean();
  const today = startOfToday();

  let notified = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const branches = await Branch.find({
      __allowGlobal: true,
      tenantId: tenant._id,
      isActive: true,
    })
      .select('_id name')
      .lean();

    for (const branch of branches) {
      const drugs = await Drug.find({
        __allowGlobal: true,
        tenantId: tenant._id,
        isActive: true,
        reorderLevel: { $gt: 0 },
      })
        .select('_id name strength reorderLevel')
        .lean();

      if (!drugs.length) continue;

      const agg = await Batch.aggregate([
        { $match: { tenantId: tenant._id, branchId: branch._id } },
        { $group: { _id: '$drugId', qty: { $sum: '$qty' } } },
      ]);
      const qtyByDrug = Object.fromEntries(agg.map((r) => [String(r._id), r.qty]));

      for (const drug of drugs) {
        const qty = qtyByDrug[String(drug._id)] || 0;
        if (qty > drug.reorderLevel) continue;

        // Dedupe: one alert per drug+branch per day
        const already = await AppNotification.findOne({
          __allowGlobal: true,
          tenantId: tenant._id,
          branchId: branch._id,
          type: 'inventory',
          'meta.drugId': String(drug._id),
          createdAt: { $gte: today },
        })
          .select('_id')
          .lean();

        if (already) {
          skipped++;
          continue;
        }

        const displayName = drug.strength ? `${drug.name} ${drug.strength}` : drug.name;

        const managers = await User.find({
          __allowGlobal: true,
          tenantId: tenant._id,
          status: 'active',
          $or: [
            { role: 'owner' },
            { role: 'branch_manager', branchIds: branch._id },
          ],
        })
          .select('_id email phone fullName')
          .lean();

        for (const m of managers) {
          notificationService
            .create({
              tenantId: tenant._id,
              userId: m._id,
              branchId: branch._id,
              type: 'inventory',
              title:
                qty === 0 ? `Out of stock: ${displayName}` : `Low stock: ${displayName}`,
              body: `Only ${qty} left (reorder at ${drug.reorderLevel}).`,
              link: `/app/inventory/${drug._id}`,
              meta: {
                drugId: String(drug._id),
                qty,
                reorderLevel: drug.reorderLevel,
              },
            })
            .catch(() => {});

          if (m.email) {
            emailService
              .sendLowStockAlert({
                tenantId: tenant._id,
                to: m.email,
                businessName: tenant.name,
                branchName: branch.name,
                productName: displayName,
                qty,
                threshold: drug.reorderLevel,
                productUrl: `/app/inventory/${drug._id}`,
              })
              .catch(() => {});
          }
        }
        notified++;
      }
    }
  }

  logger.info({ notified, skipped }, 'low-stock scan complete');
  return { notified, skipped };
}

function start() {
  task = cron.schedule(
    '*/15 * * * *',
    () => {
      run().catch((err) =>
        logger.error({ err: err.message }, 'low-stock scan failed')
      );
    },
    { timezone: TZ }
  );
  logger.info('low-stock scheduler started (15m, deduped per day)');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'lowStockAlerts', start, stop, run };