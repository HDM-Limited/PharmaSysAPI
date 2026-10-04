const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { env } = require('../../config/env');

const Payment = require('../../models/client/Payment');
const Invoice = require('../../models/client/Invoice');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Plan = require('../../models/admin/Plan');
const SuperAdmin = require('../../models/admin/SuperAdmin');
const AdminAction = require('../../models/admin/AdminAction');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.tenantId) filter.tenantId = req.query.tenantId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.method) filter.method = req.query.method;

  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  return paginated(res, items, page, limit, total);
});

/* ─────────────── GET ─────────────── */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'paymentId');
  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
  return ok(res, payment);
});

/* ─────────────── ATTEMPTS ─────────────── */

const attempts = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'paymentId');
  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');

  const items = await Payment.find({
    tenantId: payment.tenantId,
    invoiceId: payment.invoiceId,
  }).sort({ createdAt: -1 }).lean();

  return ok(res, items);
});

/* ─────────────── MARK PAID ─────────────── */

const markPaid = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'paymentId');
  const { note = null, reference = null } = req.body;

  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
  if (payment.status === 'success') throw ApiError.badRequest('ALREADY_PAID', 'Payment already marked paid');

  const paidAt = new Date();
  payment.status = 'success';
  payment.paidAt = paidAt;
  if (reference) payment.mpesaReceipt = reference;
  await payment.save();

  let invoice = null;
  if (payment.invoiceId) {
    invoice = await Invoice.findById(payment.invoiceId);
    if (invoice && invoice.status !== 'paid') {
      invoice.status = 'paid';
      invoice.amountPaid = invoice.total;
      invoice.amountDue = 0;
      invoice.paidAt = paidAt;
      invoice.paymentMethod = payment.method;
      invoice.paymentRef = reference;
      await invoice.save();
    }
  }

  const tenant = await Tenant.findById(payment.tenantId).lean();
  const owner = await User.findOne({ __allowGlobal: true, tenantId: payment.tenantId, role: 'owner' }).lean();
  const plan = tenant ? await Plan.findOne({ code: tenant.planCode }).lean() : null;

  // ── Owner notification ──
  if (owner?.email) {
    emailService
      .sendPaymentReceived({
        tenantId: payment.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        customerName: owner.fullName,
        invoiceNumber: invoice?.invoiceNumber || null,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: paidAt.toISOString(),
        paymentMethod: payment.method,
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
  if (owner?.phone && invoice?.invoiceNumber) {
    smsService
      .sendPaymentReceived({
        tenantId: payment.tenantId,
        to: owner.phone,
        invoiceNumber: invoice.invoiceNumber,
        amount: payment.amount,
        currency: payment.currency,
      })
      .catch(() => {});
  }

  // ── Admin notification ──
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
        invoiceNumber: invoice?.invoiceNumber || null,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: paidAt.toISOString(),
        paymentMethod: payment.method,
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
    tenantId: payment.tenantId,
    action: 'payment.mark_paid',
    metadata: { paymentId: String(payment._id), note, reference },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, payment.toObject());
});

/* ─────────────── MARK FAILED ─────────────── */

const markFailed = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'paymentId');
  const { reason = null } = req.body;

  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');

  payment.status = 'failed';
  payment.failureReason = reason;
  await payment.save();

  const tenant = await Tenant.findById(payment.tenantId).lean();
  const owner = await User.findOne({ __allowGlobal: true, tenantId: payment.tenantId, role: 'owner' }).lean();

  if (owner?.email) {
    emailService
      .sendSubscriptionFailed({
        tenantId: payment.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        planName: tenant?.planCode || 'Subscription',
        amount: payment.amount,
        currency: payment.currency,
        reason,
        retryUrl: `${env.appUrl}/app/billing`,
      })
      .catch(() => {});
  }
  if (owner?.phone) {
    smsService
      .sendSubscriptionFailed({
        tenantId: payment.tenantId,
        to: owner.phone,
        planName: tenant?.planCode || 'Subscription',
        retryUrl: `${env.appUrl}/app/billing`,
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: payment.tenantId,
    action: 'payment.mark_failed',
    metadata: { paymentId: String(payment._id), reason },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, payment.toObject());
});

/* ─────────────── REFUND ─────────────── */

const refund = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'paymentId');
  const { reason = null } = req.body;

  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
  if (payment.status !== 'success') throw ApiError.badRequest('NOT_REFUNDABLE', 'Only successful payments can be refunded');

  payment.status = 'refunded';
  payment.failureReason = reason;
  await payment.save();

  const tenant = await Tenant.findById(payment.tenantId).lean();
  const owner = await User.findOne({ __allowGlobal: true, tenantId: payment.tenantId, role: 'owner' }).lean();

  if (owner?.email) {
    emailService
      .sendPaymentRefunded({
        tenantId: payment.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        customerName: owner.fullName,
        amount: payment.amount,
        currency: payment.currency,
        reason,
        refundedAt: new Date().toISOString(),
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: payment.tenantId,
    action: 'payment.refund',
    reason,
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { refunded: true });
});

/* ─────────────── STATS ─────────────── */

const stats = asyncHandler(async (_req, res) => {
  const agg = await Payment.aggregate([
    { $group: { _id: { status: '$status', method: '$method' }, count: { $sum: 1 }, total: { $sum: '$amount' } } },
  ]);

  const out = { byStatus: {}, byMethod: {}, totals: { count: 0, amount: 0 } };
  for (const row of agg) {
    const { status, method } = row._id;
    out.byStatus[status] = (out.byStatus[status] || 0) + row.count;
    out.byMethod[method] = (out.byMethod[method] || 0) + row.count;
    out.totals.count += row.count;
    out.totals.amount += row.total;
  }

  return ok(res, out);
});

module.exports = { list, get, attempts, markPaid, markFailed, refund, stats };