const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { env } = require('../../config/env');
const { addMonths, addYears } = require('date-fns');

const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Plan = require('../../models/admin/Plan');
const PendingActivation = require('../../models/admin/PendingActivation');
const Invoice = require('../../models/client/Invoice');
const Subscription = require('../../models/admin/Subscription');
const AdminAction = require('../../models/admin/AdminAction');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const notificationService = require('../../services/notificationService');

function computePeriodEnd(cycle, from = new Date()) {
  if (cycle === 'once') return null;
  if (cycle === 'year') return addYears(from, 1);
  return addMonths(from, 1);
}

/* ═════════════════════════════════════════════════════════════════
   COLLECTORS
   ═════════════════════════════════════════════════════════════════ */

async function collectRegistrations() {
  const pendings = await PendingActivation.find({
    status: { $in: ['pending', 'in_review'] },
  })
    .sort({ priority: -1, registeredAt: 1 })
    .lean();

  if (!pendings.length) return [];

  const tenantIds = pendings.map((p) => p.tenantId);

  const [tenants, owners, invoices] = await Promise.all([
    Tenant.find({ _id: { $in: tenantIds } }).lean(),
    User.find({ __allowGlobal: true, tenantId: { $in: tenantIds }, role: 'owner' })
      .select('tenantId fullName email phone status')
      .lean(),
    Invoice.find({ __allowGlobal: true, tenantId: { $in: tenantIds } })
      .sort({ createdAt: -1 })
      .select('tenantId invoiceNumber purpose total amountDue currency status issuedAt dueDate')
      .lean(),
  ]);

  const tenantMap = Object.fromEntries(tenants.map((t) => [String(t._id), t]));
  const ownerMap = Object.fromEntries(owners.map((o) => [String(o.tenantId), o]));
  const invoiceMap = {};
  for (const inv of invoices) {
    const k = String(inv.tenantId);
    if (!invoiceMap[k]) invoiceMap[k] = inv;
  }

  return pendings.map((p) => ({
    id: String(p._id),
    kind: 'registration',
    status: p.status,
    priority: p.priority,
    registeredAt: p.registeredAt,
    reviewedAt: p.reviewedAt,
    tenant: tenantMap[String(p.tenantId)] || null,
    owner: ownerMap[String(p.tenantId)] || null,
    invoice: invoiceMap[String(p.tenantId)] || null,
  }));
}

async function collectInvoicesByPurpose(purpose) {
  const invoices = await Invoice.find({
    __allowGlobal: true,
    purpose,
    approvedAt: null,
    status: { $in: ['sent', 'overdue', 'paid'] },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!invoices.length) return [];

  const tenantIds = [...new Set(invoices.map((i) => String(i.tenantId)))];

  const [tenants, owners, plans] = await Promise.all([
    Tenant.find({ _id: { $in: tenantIds } })
      .select('name slug planCode country status expiresAt')
      .lean(),
    User.find({ __allowGlobal: true, tenantId: { $in: tenantIds }, role: 'owner' })
      .select('tenantId fullName email phone')
      .lean(),
    Plan.find().select('code name price').lean(),
  ]);

  const tenantMap = Object.fromEntries(tenants.map((t) => [String(t._id), t]));
  const ownerMap = Object.fromEntries(owners.map((o) => [String(o.tenantId), o]));
  const planMap = Object.fromEntries(plans.map((p) => [p.code, p]));

  return invoices.map((inv) => {
    const tenant = tenantMap[String(inv.tenantId)] || null;
    return {
      id: String(inv._id),
      kind: purpose,
      status: inv.status,
      invoiceNumber: inv.invoiceNumber,
      planCode: inv.planCode,
      currentPlan: tenant ? planMap[tenant.planCode] || null : null,
      targetPlan: inv.planCode ? planMap[inv.planCode] || null : null,
      items: inv.items,
      subtotal: inv.subtotal,
      discount: inv.discount,
      tax: inv.tax,
      total: inv.total,
      amountPaid: inv.amountPaid,
      amountDue: inv.amountDue,
      currency: inv.currency,
      issuedAt: inv.issuedAt,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      paymentMethod: inv.paymentMethod,
      paymentRef: inv.paymentRef,
      notes: inv.notes,
      tenant,
      owner: ownerMap[String(inv.tenantId)] || null,
    };
  });
}

function applySearch(items, search) {
  if (!search) return items;
  const q = String(search).trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    const n = it.tenant?.name?.toLowerCase() || '';
    const s = it.tenant?.slug?.toLowerCase() || '';
    const on = it.owner?.fullName?.toLowerCase() || '';
    const oe = it.owner?.email?.toLowerCase() || '';
    return n.includes(q) || s.includes(q) || on.includes(q) || oe.includes(q);
  });
}

/* ═════════════════════════════════════════════════════════════════
   LIST
   ═════════════════════════════════════════════════════════════════ */

const list = asyncHandler(async (req, res) => {
  const filter = String(req.query.filter || 'all').toLowerCase();
  const search = req.query.search || '';

  const valid = ['all', 'registrations', 'renewals', 'upgrades'];
  if (!valid.includes(filter)) {
    throw ApiError.badRequest('INVALID_FILTER', `filter must be one of: ${valid.join(', ')}`);
  }

  const wantReg = filter === 'all' || filter === 'registrations';
  const wantRen = filter === 'all' || filter === 'renewals';
  const wantUpg = filter === 'all' || filter === 'upgrades';

  const [reg, ren, upg] = await Promise.all([
    wantReg ? collectRegistrations() : Promise.resolve([]),
    wantRen ? collectInvoicesByPurpose('renewal') : Promise.resolve([]),
    wantUpg ? collectInvoicesByPurpose('upgrade') : Promise.resolve([]),
  ]);

  const items = {
    registrations: applySearch(reg, search),
    renewals: applySearch(ren, search),
    upgrades: applySearch(upg, search),
  };

  const list = filter === 'all'
    ? [...items.registrations, ...items.renewals, ...items.upgrades]
    : filter === 'registrations'
      ? items.registrations
      : filter === 'renewals'
        ? items.renewals
        : items.upgrades;

  return ok(res, {
    filter,
    counts: {
      registrations: reg.length,
      renewals: ren.length,
      upgrades: upg.length,
    },
    items,
    list,
  });
});

/* ═════════════════════════════════════════════════════════════════
   COUNTS
   ═════════════════════════════════════════════════════════════════ */

const counts = asyncHandler(async (_req, res) => {
  const [registrations, renewals, upgrades] = await Promise.all([
    PendingActivation.countDocuments({ status: { $in: ['pending', 'in_review'] } }),
    Invoice.countDocuments({
      __allowGlobal: true,
      purpose: 'renewal',
      approvedAt: null,
      status: { $in: ['sent', 'overdue', 'paid'] },
    }),
    Invoice.countDocuments({
      __allowGlobal: true,
      purpose: 'upgrade',
      approvedAt: null,
      status: { $in: ['sent', 'overdue', 'paid'] },
    }),
  ]);

  return ok(res, { registrations, renewals, upgrades });
});

/* ═════════════════════════════════════════════════════════════════
   GET ONE
   ═════════════════════════════════════════════════════════════════ */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'pendingId');
  const pending = await PendingActivation.findById(req.params.id).lean();
  if (!pending) throw ApiError.notFound('PENDING_NOT_FOUND', 'Pending record not found');

  const [tenant, owner, invoice] = await Promise.all([
    Tenant.findById(pending.tenantId).lean(),
    User.findOne({ __allowGlobal: true, tenantId: pending.tenantId, role: 'owner' }).lean(),
    Invoice.findOne({ __allowGlobal: true, tenantId: pending.tenantId }).sort({ createdAt: -1 }).lean(),
  ]);

  return ok(res, { pending, tenant, owner, invoice });
});

/* ═════════════════════════════════════════════════════════════════
   APPROVE (registration)
   ═════════════════════════════════════════════════════════════════ */

const approve = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'pendingId');
  const pending = await PendingActivation.findById(req.params.id);
  if (!pending) throw ApiError.notFound('PENDING_NOT_FOUND', 'Pending record not found');
  if (pending.status === 'approved') throw ApiError.badRequest('ALREADY_APPROVED', 'Already approved');

  const tenant = await Tenant.findById(pending.tenantId);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const plan = await Plan.findOne({ code: tenant.planCode }).lean();
  const now = new Date();
  const cycle = plan?.price?.interval || 'month';
  const periodEnd = computePeriodEnd(cycle, now);

  tenant.status = 'active';
  tenant.approvedAt = now;
  tenant.approvedBy = req.admin.id;
  tenant.expiresAt = periodEnd;
  await tenant.save();

  await User.updateMany(
    { __allowGlobal: true, tenantId: tenant._id, status: 'pending' },
    { $set: { status: 'active' } }
  );

  const existingSub = await Subscription.findOne({ __allowGlobal: true, tenantId: tenant._id });
  if (existingSub) {
    existingSub.planCode = tenant.planCode;
    existingSub.cycle = cycle;
    existingSub.currency = plan?.price?.currency || 'KES';
    existingSub.amountMinor = Math.round((plan?.price?.amount || 0) * 100);
    existingSub.status = cycle === 'once' ? 'perpetual' : 'active';
    existingSub.periodStart = now;
    existingSub.periodEnd = periodEnd;
    existingSub.autoRenew = cycle !== 'once';
    await existingSub.save();
  } else {
    await Subscription.create({
      tenantId: tenant._id,
      planCode: tenant.planCode,
      cycle,
      currency: plan?.price?.currency || 'KES',
      amountMinor: Math.round((plan?.price?.amount || 0) * 100),
      status: cycle === 'once' ? 'perpetual' : 'active',
      periodStart: now,
      periodEnd,
      autoRenew: cycle !== 'once',
    });
  }

  pending.status = 'approved';
  pending.decision = 'approved';
  pending.reviewedAt = now;
  pending.reviewedBy = req.admin.id;
  if (req.body.notes) pending.notes = req.body.notes;
  await pending.save();

  const owner = await User.findOne({ __allowGlobal: true, tenantId: tenant._id, role: 'owner' }).lean();

  const startDate = now.toLocaleDateString('en-KE', { dateStyle: 'medium' });
  const endDate = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-KE', { dateStyle: 'medium' })
    : null;

  if (owner?.email) {
    emailService
      .sendWelcome({
        tenantId: tenant._id,
        to: owner.email,
        name: owner.fullName,
        businessName: tenant.name,
        email: owner.email,
        loginUrl: `${env.appUrl}/login`,
        planName: plan?.name || tenant.planCode,
        planLimits: plan?.limits || null,
        planFeatures: plan?.features || null,
        startDate,
        endDate,
        trialDays: plan?.trialDays || 0,
        amount: plan?.price?.amount ?? 0,
        currency: plan?.price?.currency || 'KES',
        interval: cycle,
      })
      .catch(() => {});
  }

  if (owner?.phone) {
    smsService
      .sendWelcome({
        tenantId: tenant._id,
        to: owner.phone,
        businessName: tenant.name,
        loginUrl: `${env.appUrl}/login`,
      })
      .catch(() => {});
  }

  if (owner?._id) {
    notificationService
      .create({
        tenantId: tenant._id,
        userId: owner._id,
        type: 'success',
        title: 'Account activated',
        body: 'Your PharmaSys account is now active.',
        link: '/app/dashboard',
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'pending.approve',
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { approved: true, tenantId: tenant._id });
});

/* ═════════════════════════════════════════════════════════════════
   REJECT
   ═════════════════════════════════════════════════════════════════ */

const reject = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'pendingId');
  const { reason } = req.body;
  if (!reason) throw ApiError.badRequest('REASON_REQUIRED', 'Rejection reason required');

  const pending = await PendingActivation.findById(req.params.id);
  if (!pending) throw ApiError.notFound('PENDING_NOT_FOUND', 'Pending record not found');

  const tenant = await Tenant.findById(pending.tenantId);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  tenant.status = 'rejected';
  tenant.rejectedAt = new Date();
  tenant.rejectedBy = req.admin.id;
  tenant.rejectionReason = reason;
  await tenant.save();

  await User.updateMany(
    { __allowGlobal: true, tenantId: tenant._id },
    { $set: { status: 'rejected' } }
  );

  pending.status = 'rejected';
  pending.decision = 'rejected';
  pending.rejectionReason = reason;
  pending.reviewedAt = new Date();
  pending.reviewedBy = req.admin.id;
  await pending.save();

  const owner = await User.findOne({ __allowGlobal: true, tenantId: tenant._id, role: 'owner' }).lean();
  if (owner?.email) {
    emailService
      .sendRegistrationRejected({
        tenantId: tenant._id,
        to: owner.email,
        name: owner.fullName,
        businessName: tenant.name,
        reason,
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'pending.reject',
    reason,
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { rejected: true });
});

/* ═════════════════════════════════════════════════════════════════
   CONFIRM PAYMENT
   ═════════════════════════════════════════════════════════════════ */

const confirmPayment = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'pendingId');
  const { method, reference = null, note = null } = req.body;
  if (!method) throw ApiError.badRequest('METHOD_REQUIRED', 'Payment method required');

  const pending = await PendingActivation.findById(req.params.id).lean();
  if (!pending) throw ApiError.notFound('PENDING_NOT_FOUND', 'Pending record not found');

  const invoice = await Invoice.findOne({ __allowGlobal: true, tenantId: pending.tenantId }).sort({ createdAt: -1 });
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'No invoice for this tenant');
  if (invoice.status === 'paid') throw ApiError.badRequest('ALREADY_PAID', 'Invoice already paid');

  const paidAt = new Date();
  const amountPaid = invoice.amountDue;

  invoice.status = 'paid';
  invoice.amountPaid = amountPaid;
  invoice.amountDue = 0;
  invoice.paidAt = paidAt;
  invoice.paymentMethod = method;
  invoice.paymentRef = reference;
  if (note) invoice.notes = `${invoice.notes || ''}\nAdmin note: ${note}`.trim();
  await invoice.save();

  const tenant = await Tenant.findById(pending.tenantId).lean();
  const owner = await User.findOne({ __allowGlobal: true, tenantId: pending.tenantId, role: 'owner' }).lean();
  const plan = tenant ? await Plan.findOne({ code: tenant.planCode }).lean() : null;

  if (owner?.email) {
    emailService
      .sendPaymentReceived({
        tenantId: pending.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        customerName: owner.fullName,
        invoiceNumber: invoice.invoiceNumber,
        amount: amountPaid,
        currency: invoice.currency,
        paidAt: paidAt.toISOString(),
        paymentMethod: method,
        paymentReference: reference,
        notes: note,
        planName: plan?.name || tenant?.planCode,
        planLimits: plan?.limits,
        planFeatures: plan?.features,
        startDate: paidAt.toLocaleDateString('en-KE', { dateStyle: 'medium' }),
        endDate: tenant?.expiresAt
          ? new Date(tenant.expiresAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })
          : null,
        trialDays: plan?.trialDays || 0,
        interval: plan?.price?.interval || 'month',
      })
      .catch(() => {});
  }

  if (owner?.phone) {
    smsService
      .sendPaymentReceived({
        tenantId: pending.tenantId,
        to: owner.phone,
        invoiceNumber: invoice.invoiceNumber,
        amount: amountPaid,
        currency: invoice.currency,
      })
      .catch(() => {});
  }

  const SuperAdmin = require('../../models/admin/SuperAdmin');
  const admins = await SuperAdmin.find({ status: 'active' }).select('email').lean();
  const daysSince = tenant?.registeredAt
    ? Math.floor((Date.now() - new Date(tenant.registeredAt).getTime()) / 86_400_000)
    : undefined;

  for (const a of admins) {
    emailService
      .sendAdminPaymentReceived({
        to: a.email,
        businessName: tenant?.name || '—',
        ownerName: owner?.fullName || '—',
        ownerEmail: owner?.email || '—',
        ownerPhone: owner?.phone || null,
        invoiceNumber: invoice.invoiceNumber,
        amount: amountPaid,
        currency: invoice.currency,
        paidAt: paidAt.toISOString(),
        paymentMethod: method,
        paymentReference: reference,
        planName: plan?.name || null,
        planCode: tenant?.planCode,
        daysSinceRegistration: daysSince,
        reviewUrl: `${env.adminUrl}/pending`,
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: pending.tenantId,
    action: 'pending.confirm_payment',
    metadata: { invoiceNumber: invoice.invoiceNumber, method, reference },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, {
    invoice: {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      paidAt: invoice.paidAt,
      paymentMethod: invoice.paymentMethod,
      paymentRef: invoice.paymentRef,
    },
  });
});

/* ═════════════════════════════════════════════════════════════════
   ADD NOTES
   ═════════════════════════════════════════════════════════════════ */

const addNotes = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'pendingId');
  const pending = await PendingActivation.findByIdAndUpdate(
    req.params.id,
    { $set: { notes: req.body.notes || '' } },
    { new: true }
  ).lean();
  if (!pending) throw ApiError.notFound('PENDING_NOT_FOUND', 'Pending record not found');
  return ok(res, pending);
});

module.exports = { list, counts, get, approve, reject, confirmPayment, addNotes };