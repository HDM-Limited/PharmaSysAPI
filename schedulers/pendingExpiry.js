const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const Branch = require('../models/client/Branch');
const { Batch } = require('../models/client/Inventory');
const User = require('../models/client/User');
const AppNotification = require('../models/client/AppNotification');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { runAsTenant } = require('../models/plugins/context');
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
  const tenants = await Tenant.find({ status: 'active' }).select('_id name').lean();

  let notified = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenant of tenants) {
    try {
      const result = await runAsTenant({ tenantId: String(tenant._id) }, async () => {
        let innerNotified = 0;
        let innerSkipped = 0;

        for (const days of WINDOWS) {
          const until = new Date(now.getTime() + days * 86_400_000);

          const batches = await Batch.find({
            expiryDate: { $gte: now, $lte: until },
            qty: { $gt: 0 },
          })
            .populate('drugId', 'name strength')
            .lean();

          const groups = {};
          for (const b of batches) {
            const key = String(b.branchId);
            if (!groups[key]) {
              groups[key] = { branchId: b.branchId, items: [] };
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
            const already = await AppNotification.findOne({
              tenantId: tenant._id,
              branchId: group.branchId,
              type: 'warning',
              'meta.expiryWindow': days,
              createdAt: { $gte: today },
            })
              .select('_id')
              .lean();

            if (already) {
              innerSkipped++;
              continue;
            }

            const branch = await Branch.findById(group.branchId).select('name').lean();

            const owners = await User.find({
              tenantId: tenant._id,
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
                  tenantId: tenant._id,
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
                    tenantId: tenant._id,
                    to: owner.email,
                    businessName: tenant.name,
                    branchName: branch?.name,
                    items: group.items.slice(0, 10),
                    daysLeft: days,
                    reportUrl: '/app/inventory/expiring',
                  })
                  .catch(() => {});
              }
            }
            innerNotified++;
          }
        }

        return { notified: innerNotified, skipped: innerSkipped };
      });

      notified += result.notified;
      skipped += result.skipped;
    } catch (err) {
      failed++;
      logger.warn(
        { err: err.message, tenantId: String(tenant._id) },
        'pending-expiry scan failed for tenant'
      );
    }
  }

  logger.info(
    { notified, skipped, failed, tenants: tenants.length },
    'pending-expiry scan complete'
  );
  return { notified, skipped, failed };
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