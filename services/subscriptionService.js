const { addMonths, addYears } = require('date-fns');
const Subscription = require('../models/admin/Subscription');
const Tenant = require('../models/admin/Tenant');
const planService = require('./planService');

function computePeriodEnd(cycle, from = new Date()) {
  const base = from instanceof Date ? from : new Date(from);
  if (cycle === 'once') return null;
  if (cycle === 'year') return addYears(base, 1);
  return addMonths(base, 1);
}

async function activate({ tenantId, planCode, cycle, currency, amount }) {
  const now = new Date();
  const periodEnd = computePeriodEnd(cycle, now);

  const sub = await Subscription.findOneAndUpdate(
    { tenantId },
    {
      tenantId,
      planCode,
      cycle,
      currency,
      amountMinor: Math.round(Number(amount || 0) * 100),
      status: cycle === 'once' ? 'perpetual' : 'active',
      periodStart: now,
      periodEnd,
      autoRenew: cycle !== 'once',
      cancelledAt: null,
      cancelledReason: null,
    },
    { upsert: true, new: true }
  );

  await Tenant.updateOne(
    { _id: tenantId },
    { $set: { planCode, expiresAt: periodEnd, status: 'active' } }
  );

  planService.invalidateCache(planCode);
  return sub;
}

async function extend({ tenantId }) {
  const sub = await Subscription.findOne({ tenantId });
  if (!sub) return null;

  const now = new Date();
  const base = sub.periodEnd && sub.periodEnd > now ? sub.periodEnd : now;
  const periodEnd = computePeriodEnd(sub.cycle, base);

  sub.periodStart = now;
  sub.periodEnd = periodEnd;
  sub.status = 'active';
  sub.lastRenewalAt = now;
  sub.renewalCount = (sub.renewalCount || 0) + 1;
  await sub.save();

  await Tenant.updateOne(
    { _id: tenantId },
    { $set: { expiresAt: periodEnd, status: 'active' } }
  );

  return sub;
}

async function cancel({ tenantId, reason = null }) {
  const sub = await Subscription.findOne({ tenantId });
  if (!sub) return null;
  sub.status = 'cancelled';
  sub.cancelledAt = new Date();
  sub.cancelledReason = reason;
  sub.autoRenew = false;
  await sub.save();
  return sub;
}

async function get(tenantId) {
  return Subscription.findOne({ tenantId }).lean();
}

module.exports = {
  computePeriodEnd,
  activate,
  extend,
  cancel,
  get,
};