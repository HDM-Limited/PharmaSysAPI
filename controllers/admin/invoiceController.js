const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { env } = require('../../config/env');
const { addMonths, addYears } = require('date-fns');

const Invoice = require('../../models/client/Invoice');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Plan = require('../../models/admin/Plan');
const Subscription = require('../../models/admin/Subscription');
const Payment = require('../../models/client/Payment');
const AdminAction = require('../../models/admin/AdminAction');
const emailService = require('../../services/emailService');

function computePeriodEnd(cycle, from = new Date()) {
  if (cycle === 'once') return null;
  if (cycle === 'year') return addYears(from, 1);
  return addMonths(from, 1);
}

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.tenantId) filter.tenantId = req.query.tenantId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.purpose) filter.purpose = req.query.purpose;
  if (req.query.approved === 'false') filter.approvedAt = null;
  if (req.query.approved === 'true') filter.approvedAt = { $ne: null };

  const [items, total] = await Promise.all([
    Invoice.find(filter)
      .populate('tenantId', 'name slug planCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  const enriched = items.map((i) => ({
    ...i,
    tenant: i.tenantId && typeof i.tenantId === 'object'
      ? { id: i.tenantId._id, name: i.tenantId.name, planCode: i.tenantId.planCode }
      : null,
  }));

  return paginated(res, enriched, page, limit, total);
});

/* ─────────────── GET ─────────────── */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');

  const invoice = await Invoice.findOne({ __allowGlobal: true, _id: req.params.id })
    .populate('tenantId', 'name slug planCode country registeredAt expiresAt')
    .lean();

  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');

  const [owner, plan, payment] = await Promise.all([
    User.findOne({ __allowGlobal: true, tenantId: invoice.tenantId, role: 'owner' })
      .select('fullName email phone status')
      .lean(),
    invoice.tenantId?.planCode
      ? Plan.findOne({ code: invoice.tenantId.planCode }).lean()
      : null,
    Payment.findOne({ __allowGlobal: true, invoiceId: invoice._id })
      .sort({ createdAt: -1 })
      .select('method status mpesaReceipt providerRef paidAt amount currency')
      .lean(),
  ]);

  const tenant = invoice.tenantId && typeof invoice.tenantId === 'object'
    ? {
        id: invoice.tenantId._id,
        name: invoice.tenantId.name,
        slug: invoice.tenantId.slug,
        planCode: invoice.tenantId.planCode,
        country: invoice.tenantId.country,
        registeredAt: invoice.tenantId.registeredAt,
        expiresAt: invoice.tenantId.expiresAt,
      }
    : null;

  return ok(res, {
    ...invoice,
    tenant,
    owner: owner
      ? {
          id: owner._id,
          fullName: owner.fullName,
          email: owner.email,
          phone: owner.phone,
          status: owner.status,
        }
      : null,
    plan: plan
      ? { code: plan.code, name: plan.name, price: plan.price, limits: plan.limits, features: plan.features }
      : null,
    payment: payment || null,
  });
});

/* ─────────────── MARK PAID ─────────────── */

const markPaid = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const { method, reference = null, note = null } = req.body;
  if (!method) throw ApiError.badRequest('METHOD_REQUIRED', 'Payment method required');

  const invoice = await Invoice.findOne({ __allowGlobal: true, _id: req.params.id });
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  if (invoice.status === 'paid') throw ApiError.badRequest('ALREADY_PAID', 'Invoice already paid');

  const paidAt = new Date();
  invoice.status = 'paid';
  invoice.amountPaid = invoice.total;
  invoice.amountDue = 0;
  invoice.paidAt = paidAt;
  invoice.paymentMethod = method;
  invoice.paymentRef = reference;
  if (note) invoice.notes = `${invoice.notes || ''}\nAdmin note: ${note}`.trim();
  await invoice.save();

  const tenant = await Tenant.findById(invoice.tenantId).lean();
  const owner = await User.findOne({ __allowGlobal: true, tenantId: invoice.tenantId, role: 'owner' }).lean();
  const plan = tenant ? await Plan.findOne({ code: tenant.planCode }).lean() : null;

  if (owner?.email) {
    emailService
      .sendPaymentReceived({
        tenantId: invoice.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        customerName: owner.fullName,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amountPaid,
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

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: invoice.tenantId,
    action: 'invoice.mark_paid',
    metadata: { invoiceNumber: invoice.invoiceNumber, method, reference },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, invoice.toObject());
});

/* ─────────────── APPROVE RENEWAL / UPGRADE ─────────────── */

const approveRenewal = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');

  const invoice = await Invoice.findOne({ __allowGlobal: true, _id: req.params.id });
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  if (invoice.status !== 'paid') {
    throw ApiError.badRequest('NOT_PAID', 'Invoice must be paid before approval');
  }
  if (!['renewal', 'upgrade'].includes(invoice.purpose)) {
    throw ApiError.badRequest(
      'INVALID_PURPOSE',
      `Invoice purpose is '${invoice.purpose}'. Only renewal or upgrade can be approved.`
    );
  }
  if (invoice.approvedAt) {
    throw ApiError.badRequest('ALREADY_APPROVED', 'Invoice already approved');
  }

  const tenant = await Tenant.findById(invoice.tenantId);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const now = new Date();
  const oldPlanCode = tenant.planCode;

  if (invoice.purpose === 'upgrade' && invoice.planCode) {
    tenant.planCode = invoice.planCode;
  }

  const plan = await Plan.findOne({ code: tenant.planCode }).lean();
  const cycle = plan?.price?.interval || 'month';
  const base = tenant.expiresAt && new Date(tenant.expiresAt) > now
    ? new Date(tenant.expiresAt)
    : now;

  tenant.expiresAt = computePeriodEnd(cycle, base);
  tenant.status = 'active';
  tenant.approvedAt = now;
  tenant.approvedBy = req.admin.id;
  await tenant.save();

  /* ─── Subscription ─── */
  const sub = await Subscription.findOne({ tenantId: tenant._id });
  if (sub) {
    sub.planCode = tenant.planCode;
    sub.cycle = cycle;
    sub.currency = plan?.price?.currency || 'KES';
    sub.amountMinor = Math.round((plan?.price?.amount || 0) * 100);
    sub.status = cycle === 'once' ? 'perpetual' : 'active';
    sub.periodStart = now;
    sub.periodEnd = tenant.expiresAt;
    sub.autoRenew = cycle !== 'once';
    sub.lastRenewalAt = now;
    sub.renewalCount = (sub.renewalCount || 0) + 1;
    await sub.save();
  } else {
    await Subscription.create({
      tenantId: tenant._id,
      planCode: tenant.planCode,
      cycle,
      currency: plan?.price?.currency || 'KES',
      amountMinor: Math.round((plan?.price?.amount || 0) * 100),
      status: cycle === 'once' ? 'perpetual' : 'active',
      periodStart: now,
      periodEnd: tenant.expiresAt,
      autoRenew: cycle !== 'once',
      lastRenewalAt: now,
      renewalCount: 1,
    });
  }

  /* ─── Mark invoice approved so it stops showing as pending ─── */
  invoice.approvedAt = now;
  invoice.approvedBy = req.admin.id;
  await invoice.save();

  /* ─── Notify owner ─── */
  const owner = await User.findOne({
    __allowGlobal: true,
    tenantId: tenant._id,
    role: 'owner',
  }).lean();

  if (owner?.email) {
    if (invoice.purpose === 'upgrade') {
      const oldPlan = oldPlanCode ? await Plan.findOne({ code: oldPlanCode }).lean() : null;

      await emailService.sendUpgradeApproved({
        tenantId: tenant._id,
        to: owner.email,
        name: owner.fullName,
        businessName: tenant.name,
        fromPlan: oldPlan?.name || oldPlanCode,
        toPlan: plan?.name || tenant.planCode,
        planLimits: plan?.limits,
        planFeatures: plan?.features,
        amount: invoice.amountPaid,
        currency: invoice.currency,
        periodStart: now.toISOString(),
        periodEnd: tenant.expiresAt?.toISOString(),
        reference: invoice.paymentRef,
        loginUrl: `${env.appUrl}/app/dashboard`,
      }).catch(() => {});
    } else {
      await emailService.sendRenewalApproved({
        tenantId: tenant._id,
        to: owner.email,
        name: owner.fullName,
        businessName: tenant.name,
        planName: plan?.name || tenant.planCode,
        amount: invoice.amountPaid,
        currency: invoice.currency,
        periodStart: now.toISOString(),
        periodEnd: tenant.expiresAt?.toISOString(),
        reference: invoice.paymentRef,
        loginUrl: `${env.appUrl}/app/dashboard`,
      }).catch(() => {});
    }
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: invoice.purpose === 'upgrade' ? 'invoice.approve_upgrade' : 'invoice.approve_renewal',
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      fromPlan: oldPlanCode,
      toPlan: tenant.planCode,
      newPeriodEnd: tenant.expiresAt,
    },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, {
    approved: true,
    tenantId: tenant._id,
    planCode: tenant.planCode,
    newPeriodEnd: tenant.expiresAt,
  });
});

/* ─────────────── CANCEL ─────────────── */

const cancel = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const { reason = null } = req.body;

  const invoice = await Invoice.findOne({ __allowGlobal: true, _id: req.params.id });
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  if (invoice.status === 'paid') throw ApiError.badRequest('ALREADY_PAID', 'Cannot cancel a paid invoice');

  invoice.status = 'cancelled';
  invoice.notes = `${invoice.notes || ''}\nCancelled: ${reason || 'no reason'}`.trim();
  await invoice.save();

  const tenant = await Tenant.findById(invoice.tenantId).lean();
  const owner = await User.findOne({ __allowGlobal: true, tenantId: invoice.tenantId, role: 'owner' }).lean();

  if (owner?.email) {
    emailService
      .sendInvoiceCancelled({
        tenantId: invoice.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        customerName: owner.fullName,
        invoiceNumber: invoice.invoiceNumber,
        reason,
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: invoice.tenantId,
    action: 'invoice.cancel',
    reason,
    ip: req.ip,
  }).catch(() => {});

  return ok(res, invoice.toObject());
});

/* ─────────────── RESEND ─────────────── */

const resend = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const invoice = await Invoice.findOne({ __allowGlobal: true, _id: req.params.id }).lean();
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');

  const [tenant, owner] = await Promise.all([
    Tenant.findById(invoice.tenantId).lean(),
    User.findOne({ __allowGlobal: true, tenantId: invoice.tenantId, role: 'owner' }).lean(),
  ]);

  if (owner?.email) {
    await emailService.sendInvoice({
      tenantId: invoice.tenantId,
      to: owner.email,
      businessName: tenant?.name,
      customerName: owner.fullName,
      invoiceNumber: invoice.invoiceNumber,
      items: invoice.items,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      tax: invoice.tax,
      total: invoice.total,
      amountDue: invoice.amountDue,
      currency: invoice.currency,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
      notes: invoice.notes,
      instructions: invoice.paymentInstructions,
      payUrl: `${env.appUrl}/invoice/${invoice.invoiceNumber}`,
    });
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: invoice.tenantId,
    action: 'invoice.resend',
    metadata: { invoiceNumber: invoice.invoiceNumber },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { resent: true });
});

module.exports = { list, get, markPaid, approveRenewal, cancel, resend };