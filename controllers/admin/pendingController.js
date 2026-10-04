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

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { status: { $in: ['pending', 'in_review'] } };

  const [items, total] = await Promise.all([
    PendingActivation.find(filter).sort({ priority: -1, registeredAt: 1 }).skip(skip).limit(limit).lean(),
    PendingActivation.countDocuments(filter),
  ]);

  const tenantIds = items.map((i) => i.tenantId);
  const [tenants, owners, invoices] = await Promise.all([
    Tenant.find({ _id: { $in: tenantIds } }).lean(),
    User.find({ __allowGlobal: true, tenantId: { $in: tenantIds }, role: 'owner' })
      .select('tenantId fullName email phone')
      .lean(),
    Invoice.find({ __allowGlobal: true, tenantId: { $in: tenantIds } })
      .select('tenantId invoiceNumber total amountDue currency status dueDate issuedAt')
      .lean(),
  ]);

  const tenantsById = Object.fromEntries(tenants.map((t) => [String(t._id), t]));
  const ownersByTenant = Object.fromEntries(owners.map((o) => [String(o.tenantId), o]));
  const invoicesByTenant = Object.fromEntries(invoices.map((i) => [String(i.tenantId), i]));

  const enriched = items.map((i) => ({
    ...i,
    tenant: tenantsById[String(i.tenantId)] || null,
    owner: ownersByTenant[String(i.tenantId)] || null,
    invoice: invoicesByTenant[String(i.tenantId)] || null,
  }));

  return paginated(res, enriched, page, limit, total);
});

/* ─────────────── GET ─────────────── */

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

/* ─────────────── APPROVE ─────────────── */

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

/* ─────────────── REJECT ─────────────── */

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

/* ─────────────── CONFIRM PAYMENT ─────────────── */

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

  // Notify all admins
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

/* ─────────────── ADD NOTES ─────────────── */

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

module.exports = { list, get, approve, reject, confirmPayment, addNotes };