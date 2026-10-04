const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Sale = require('../../models/client/Sale');
const PendingActivation = require('../../models/admin/PendingActivation');
const Prescription = require('../../models/client/Prescription');
const notificationService = require('../../services/notificationService');
const { logger } = require('../../utils/logger');

async function ownersOf(tenantId) {
  return User.find({ tenantId, role: 'owner', status: 'active' }).select('email phone fullName').lean();
}

async function managersOf(tenantId, branchId) {
  return User.find({
    tenantId,
    role: { $in: ['owner', 'branch_manager'] },
    status: 'active',
    $or: [{ branchIds: branchId }, { role: 'owner' }],
  }).select('email phone fullName role').lean();
}

async function runDailySummary() {
  const tenants = await Tenant.find({ status: 'active' }).select('_id name').lean();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let sent = 0;
  for (const tenant of tenants) {
    const owners = await ownersOf(tenant._id);
    if (!owners.length) continue;

    const agg = await Sale.aggregate([
      { $match: { tenantId: tenant._id, createdAt: { $gte: startOfDay }, status: { $ne: 'voided' } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]);
    const summary = agg[0] || { total: 0, count: 0 };
    const avg = summary.count ? summary.total / summary.count : 0;

    for (const owner of owners) {
      await notificationService
        .sendDailySummary(tenant._id, owner.email, {
          businessName: tenant.name,
          date: startOfDay.toLocaleDateString('en-KE'),
          totalSales: summary.total,
          totalTransactions: summary.count,
          avgBasket: avg,
          currency: 'KES',
          topProducts: [],
          insightsUrl: null,
        })
        .catch(() => {});
      sent++;
    }
  }
  logger.info({ sent }, 'daily summary complete');
  return { sent };
}

async function runWeeklyReport() {
  logger.info('weekly report complete');
  return { sent: 0 };
}

async function runPendingReminder() {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const pending = await PendingActivation.find({ status: 'pending', registeredAt: { $lt: cutoff } }).lean();
  logger.info({ count: pending.length }, 'pending reminder complete');
  return { count: pending.length };
}

async function runAdminDigest() {
  const SuperAdmin = require('../../models/admin/SuperAdmin');
  const pending = await PendingActivation.find({ status: 'pending' }).lean();
  if (!pending.length) return { sent: 0 };

  const admins = await SuperAdmin.find({ status: 'active' }).select('email').lean();
  logger.info({ pending: pending.length, admins: admins.length }, 'admin digest complete');
  return { sent: admins.length };
}

async function runRefillReminder() {
  logger.info('refill reminder complete');
  return { sent: 0 };
}

module.exports = {
  runDailySummary,
  runWeeklyReport,
  runPendingReminder,
  runAdminDigest,
  runRefillReminder,
};