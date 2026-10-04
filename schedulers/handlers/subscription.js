const { addMonths, addYears } = require('date-fns');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Subscription = require('../../models/admin/Subscription');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const notificationService = require('../../services/notificationService');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');

async function ownersOf(tenantId) {
  return User.find({
    __allowGlobal: true,
    tenantId,
    role: 'owner',
    status: 'active',
  })
    .select('email phone fullName')
    .lean();
}

/* ─────────────── EXPIRING REMINDERS ─────────────── */

async function runSubscriptionExpiring() {
  const now = new Date();
  const windows = [7, 3, 1];
  let sent = 0;
  let failed = 0;

  for (const days of windows) {
    const start = new Date(now.getTime() + days * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);

    const subs = await Subscription.find({
      status: 'active',
      periodEnd: { $gte: start, $lt: end },
    }).lean();

    for (const sub of subs) {
      const tenant = await Tenant.findById(sub.tenantId).select('name planCode').lean();
      const owners = await ownersOf(sub.tenantId);

      for (const owner of owners) {
        if (owner.email) {
          await emailService
            .sendSubscriptionExpiring({
              tenantId: sub.tenantId,
              to: owner.email,
              businessName: tenant?.name || 'PharmaSys',
              planName: sub.planCode,
              daysLeft: days,
              expiresAt: sub.periodEnd?.toISOString(),
              renewUrl: `${env.appUrl}/app/billing`,
            })
            .then(() => { sent++; })
            .catch((err) => {
              failed++;
              logger.warn(
                { err: err.message, tenantId: String(sub.tenantId), days },
                'expiring email failed'
              );
            });
        }

        if (owner.phone) {
          await smsService
            .sendSubscriptionExpiring({
              tenantId: sub.tenantId,
              to: owner.phone,
              planName: sub.planCode,
              daysLeft: days,
              renewUrl: `${env.appUrl}/app/billing`,
            })
            .then(() => { sent++; })
            .catch((err) => {
              failed++;
              logger.warn(
                { err: err.message, tenantId: String(sub.tenantId), days },
                'expiring sms failed'
              );
            });
        }

        notificationService
          .create({
            tenantId: sub.tenantId,
            userId: owner._id,
            type: 'warning',
            title: `Subscription expires in ${days} day${days === 1 ? '' : 's'}`,
            body: `Renew your ${sub.planCode} plan to keep access.`,
            link: '/app/billing',
          })
          .catch(() => {});
      }
    }
  }

  logger.info({ sent, failed, windows: windows.length }, 'subscription expiring scan complete');
  return { sent, failed };
}

/* ─────────────── EXPIRY ENFORCEMENT ─────────────── */

async function runSubscriptionExpired() {
  const now = new Date();

  const subs = await Subscription.find({
    status: 'active',
    periodEnd: { $lt: now },
  })
    .select('_id tenantId periodEnd')
    .lean();

  let expired = 0;
  let skipped = 0;

  for (const sub of subs) {
    // Atomic flip on Subscription — only succeeds if still active.
    const fresh = await Subscription.findOneAndUpdate(
      { _id: sub._id, status: 'active' },
      { $set: { status: 'expired' } },
      { new: true }
    );

    if (!fresh) {
      skipped++;
      continue; // another process already got it
    }

    // Atomic flip on Tenant — only if still active.
    const tenant = await Tenant.findOneAndUpdate(
      { _id: sub.tenantId, status: 'active' },
      { $set: { status: 'expired' } },
      { new: true }
    );

    // Notify owners even if tenant was already expired by middleware.
    const owners = await ownersOf(sub.tenantId);
    const planName = tenant?.planCode || 'your plan';

    for (const owner of owners) {
      if (owner.email) {
        emailService
          .sendSubscriptionExpired({
            tenantId: sub.tenantId,
            to: owner.email,
            businessName: tenant?.name || 'PharmaSys',
            planName,
            renewUrl: `${env.appUrl}/app/billing`,
          })
          .catch((err) =>
            logger.warn(
              { err: err.message, tenantId: String(sub.tenantId) },
              'expired email failed'
            )
          );
      }

      if (owner.phone) {
        smsService
          .sendSubscriptionExpired({
            tenantId: sub.tenantId,
            to: owner.phone,
            planName,
            renewUrl: `${env.appUrl}/app/billing`,
          })
          .catch((err) =>
            logger.warn(
              { err: err.message, tenantId: String(sub.tenantId) },
              'expired sms failed'
            )
          );
      }

      notificationService
        .create({
          tenantId: sub.tenantId,
          userId: owner._id,
          type: 'error',
          title: 'Subscription expired',
          body: 'Renew now to restore access.',
          link: '/app/billing',
        })
        .catch(() => {});
    }

    expired++;
  }

  logger.info({ expired, skipped, total: subs.length }, 'subscription expiry scan complete');
  return { expired, skipped };
}

/* ─────────────── PAST-DUE ESCALATION ─────────────── */

async function runSubscriptionPastDue() {
  const subs = await Subscription.find({ status: 'past_due' })
    .select('_id tenantId periodEnd')
    .lean();

  let sent = 0;

  for (const sub of subs) {
    const tenant = await Tenant.findById(sub.tenantId).select('name planCode').lean();
    const owners = await ownersOf(sub.tenantId);

    for (const owner of owners) {
      if (owner.email) {
        emailService
          .sendSubscriptionFailed({
            tenantId: sub.tenantId,
            to: owner.email,
            businessName: tenant?.name || 'PharmaSys',
            planName: sub.planCode,
            amount: 0,
            currency: 'KES',
            reason: 'Payment past due',
            retryUrl: `${env.appUrl}/app/billing`,
          })
          .catch(() => {});
        sent++;
      }
    }
  }

  logger.info({ sent }, 'subscription past-due scan complete');
  return { sent };
}

module.exports = {
  runSubscriptionExpiring,
  runSubscriptionExpired,
  runSubscriptionPastDue,
};