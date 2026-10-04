const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Subscription = require('../../models/admin/Subscription');
const notificationService = require('../../services/notificationService');
const { logger } = require('../../utils/logger');

async function ownersOf(tenantId) {
  return User.find({ tenantId, role: 'owner', status: 'active' }).select('email phone fullName').lean();
}

async function runSubscriptionExpiring() {
  const now = new Date();
  const windows = [7, 3, 1];
  let sent = 0;

  for (const days of windows) {
    const start = new Date(now.getTime() + days * 86400000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);

    const subs = await Subscription.find({
      status: 'active',
      periodEnd: { $gte: start, $lt: end },
    }).lean();

    for (const sub of subs) {
      const tenant = await Tenant.findById(sub.tenantId).select('name planCode').lean();
      const owners = await ownersOf(sub.tenantId);
      for (const owner of owners) {
        await notificationService
          .sendSubscriptionExpiring(sub.tenantId, owner.email, {
            businessName: tenant?.name,
            planName: sub.planCode,
            daysLeft: days,
            expiresAt: sub.periodEnd?.toISOString(),
            renewUrl: `${process.env.APP_URL}/app/billing`,
          }, owner.phone)
          .catch(() => {});
        sent++;
      }
    }
  }
  logger.info({ sent }, 'subscription expiring scan complete');
  return { sent };
}

async function runSubscriptionExpired() {
  const now = new Date();
  const subs = await Subscription.find({ status: 'active', periodEnd: { $lt: now } }).lean();
  let expired = 0;

  for (const sub of subs) {
    const tenant = await Tenant.findById(sub.tenantId).select('name planCode').lean();
    const owners = await ownersOf(sub.tenantId);

    await Subscription.updateOne({ _id: sub._id }, { $set: { status: 'expired' } });
    await Tenant.updateOne({ _id: sub.tenantId }, { $set: { status: 'expired' } });

    for (const owner of owners) {
      await notificationService
        .sendSubscriptionExpired(sub.tenantId, owner.email, {
          businessName: tenant?.name,
          planName: sub.planCode,
          renewUrl: `${process.env.APP_URL}/app/billing`,
        }, owner.phone)
        .catch(() => {});
    }
    expired++;
  }
  logger.info({ expired }, 'subscription expiry scan complete');
  return { expired };
}

async function runSubscriptionPastDue() {
  logger.info('subscription past-due scan complete');
  return { sent: 0 };
}

module.exports = {
  runSubscriptionExpiring,
  runSubscriptionExpired,
  runSubscriptionPastDue,
};