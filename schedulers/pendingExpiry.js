const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const Branch = require('../models/client/Branch');
const { Batch } = require('../models/client/Inventory');
const User = require('../models/client/User');
const AppNotification = require('../models/client/AppNotification');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';
const WINDOWS = [30, 14, 7];

let task = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function run() {
  const now = new Date();
  const today = startOfToday();
  let notified = 0;
  let skipped = 0;

  for (const days of WINDOWS) {
    const until = new Date(now.getTime() + days * 86_400_000);

    const batches = await Batch.find({
      __allowGlobal: true,
      expiryDate: { $gte: now, $lte: until },
      qty: { $gt: 0 },
    })
      .populate('drugId', 'name strength')
      .lean();

    // Group by tenant + branch + window
    const groups = {};
    for (const b of batches) {
      const key = `${b.tenantId}:${b.branchId}:${days}`;
      if (!groups[key]) {
        groups[key] = {
          tenantId: b.tenantId,
          branchId: b.branchId,
          days,
          items: [],
        };
      }
      groups[key].items.push({
        name: b.drugId?.strength
          ? `${b.drugId.name} ${b.drugId.strength}`
          : b.drugId?.name || 'Unknown',
        qty: b.qty,
        expiryDate: b.expiryDate,
      });
    }

    for (const group of Object.values(groups)) {
      // Dedupe: one alert per branch+window per day
      const already = await AppNotification.findOne({
        __allowGlobal: true,
        tenantId: group.tenantId,
        branchId: group.branchId,
        type: 'warning',
        'meta.expiryWindow': days,
        createdAt: { $gte: today },
      })
        .select('_id')
        .lean();

      if (already) {
        skipped++;
        continue;
      }

      const tenant = await Tenant.findById(group.tenantId).select('name').lean();
      const branch = await Branch.findById(group.branchId).select('name').lean();

      const owners = await User.find({
        __allowGlobal: true,
        tenantId: group.tenantId,
        status: 'active',
        $or: [
          { role: 'owner' },
          { role: 'branch_manager', branchIds: group.branchId },
        ],
      })
        .select('_id email fullName')
        .lean();

      for (const owner of owners) {
        notificationService
          .create({
            tenantId: group.tenantId,
            userId: owner._id,
            branchId: group.branchId,
            type: 'warning',
            title: `${group.items.length} batch${
              group.items.length === 1 ? '' : 'es'
            } expiring in ${days} day${days === 1 ? '' : 's'}`,
            body: group.items
              .slice(0, 3)
              .map((i) => `${i.name} (${i.qty})`)
              .join(', '),
            link: '/app/inventory/expiring',
            meta: { expiryWindow: days, count: group.items.length },
          })
          .catch(() => {});

        if (owner.email) {
          emailService
            .sendExpiryAlert({
              tenantId: group.tenantId,
              to: owner.email,
              businessName: tenant?.name || 'PharmaSys',
              branchName: branch?.name,
              items: group.items.slice(0, 10),
              daysLeft: days,
              reportUrl: '/app/inventory/expiring',
            })
            .catch(() => {});
        }
      }
      notified++;
    }
  }

  logger.info({ notified, skipped }, 'pending-expiry scan complete');
  return { notified, skipped };
}

function start() {
  task = cron.schedule(
    '0 6 * * *',
    () => {
      run().catch((err) =>
        logger.error({ err: err.message }, 'pending expiry scan failed')
      );
    },
    { timezone: TZ }
  );
  logger.info('pending-expiry scheduler started (daily, deduped)');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'pendingExpiry', start, stop, run };