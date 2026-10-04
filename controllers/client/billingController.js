const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const { addMonths, addYears } = require('date-fns');

const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');
const Subscription = require('../../models/admin/Subscription');
const Invoice = require('../../models/client/Invoice');
const Payment = require('../../models/client/Payment');
const SuperAdmin = require('../../models/admin/SuperAdmin');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const mpesaService = require('../../services/mpesaService');
const paymentInstructionsService = require('../../services/paymentInstructionsService');
const { mpesaConfig } = require('../../config/mpesa');
const { env } = require('../../config/env');

/* ─────────────── helpers ─────────────── */

function computePeriodEnd(cycle, from = new Date()) {
  if (cycle === 'once') return null;
  if (cycle === 'year') return addYears(from, 1);
  return addMonths(from, 1);
}

function generateInvoiceNumber(prefix = 'INV') {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${y}${m}${d}-${rand}`;
}

function humanDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleString('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  });
}

/**
 * What invoice purposes are visible for this tenant?
 *   - active tenants  → only plan-change invoices (renewal, upgrade)
 *   - pending tenants → also their registration invoice (shown on /pending)
 */
function visiblePurposes(tenantStatus) {
  return tenantStatus === 'active'
    ? ['renewal', 'upgrade']
    : ['registration', 'renewal', 'upgrade'];
}

/* ─────────────── STATUS ─────────────── */

const status = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select('planCode status expiresAt').lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const [plan, sub] = await Promise.all([
    Plan.findOne({ code: tenant.planCode }).lean(),
    Subscription.findOne({ tenantId: req.tenantId }).lean(),
  ]);

  const now = Date.now();
  const periodEnd = sub?.periodEnd ? new Date(sub.periodEnd).getTime() : null;
  const daysLeft = periodEnd ? Math.ceil((periodEnd - now) / 86_400_000) : null;

  return ok(res, {
    planCode: tenant.planCode,
    planName: plan?.name || tenant.planCode,
    status: sub?.status || (tenant.status === 'active' ? 'active' : 'expired'),
    currency: sub?.currency || plan?.price?.currency || 'KES',
    amountMinor: sub?.amountMinor ?? Math.round((plan?.price?.amount || 0) * 100),
    periodStart: sub?.periodStart || null,
    periodEnd: sub?.periodEnd || null,
    autoRenew: sub?.autoRenew ?? false,
    daysLeft,
    limits: plan?.limits || null,
    features: plan?.features || null,
  });
});

/* ─────────────── PENDING INVOICE ─────────────── */

const pendingInvoice = asyncHandler(async (req, res) => {
  const purposes = visiblePurposes(req.tenant?.status);

  const unpaid = await Invoice.findOne({
    __allowGlobal: true,
    tenantId: req.tenantId,
    purpose: { $in: purposes },
    status: { $in: ['sent', 'overdue'] },
    amountDue: { $gt: 0 },
    approvedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!unpaid) return ok(res, null);

  return ok(res, {
    invoiceNumber: unpaid.invoiceNumber,
    purpose: unpaid.purpose,
    planCode: unpaid.planCode,
    items: unpaid.items,
    subtotal: unpaid.subtotal,
    discount: unpaid.discount,
    tax: unpaid.tax,
    total: unpaid.total,
    amountPaid: unpaid.amountPaid,
    amountDue: unpaid.amountDue,
    currency: unpaid.currency,
    status: unpaid.status,
    issuedAt: unpaid.issuedAt,
    dueDate: unpaid.dueDate,
    paidAt: unpaid.paidAt,
    paymentMethod: unpaid.paymentMethod,
    paymentRef: unpaid.paymentRef,
    notes: unpaid.notes,
    paymentInstructions: unpaid.paymentInstructions || [],
  });
});

/* ─────────────── INVOICE (latest, unapproved) ─────────────── */

const invoice = asyncHandler(async (req, res) => {
  const purposes = visiblePurposes(req.tenant?.status);

  const latest = await Invoice.findOne({
    __allowGlobal: true,
    tenantId: req.tenantId,
    purpose: { $in: purposes },
    approvedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!latest) return ok(res, null);

  return ok(res, {
    invoiceNumber: latest.invoiceNumber,
    purpose: latest.purpose,
    planCode: latest.planCode,
    customerSnapshot: latest.customerSnapshot,
    items: latest.items,
    subtotal: latest.subtotal,
    discount: latest.discount,
    tax: latest.tax,
    total: latest.total,
    amountPaid: latest.amountPaid,
    amountDue: latest.amountDue,
    currency: latest.currency,
    status: latest.status,
    issuedAt: latest.issuedAt,
    dueDate: latest.dueDate,
    paidAt: latest.paidAt,
    paymentMethod: latest.paymentMethod,
    paymentRef: latest.paymentRef,
    notes: latest.notes,
    paymentInstructions: latest.paymentInstructions || [],
  });
});

/* ─────────────── RENEW / UPGRADE ─────────────── */

const renew = asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can renew or upgrade');
  }

  const { planCode } = req.body;
  if (!planCode) throw ApiError.badRequest('MISSING_PLAN', 'planCode required');

  const newPlan = await Plan.findOne({ code: planCode, isActive: true, isPublic: true }).lean();
  if (!newPlan) throw ApiError.badRequest('INVALID_PLAN', `Plan '${planCode}' not available`);

  /* Guard: no open plan-change invoice */
  const openInvoice = await Invoice.findOne({
    __allowGlobal: true,
    tenantId: req.tenantId,
    purpose: { $in: ['renewal', 'upgrade'] },
    approvedAt: null,
    status: { $in: ['sent', 'overdue', 'paid'] },
  }).lean();

  if (openInvoice) {
    throw ApiError.badRequest(
      'INVOICE_PENDING',
      `You already have a ${openInvoice.purpose} in progress (${openInvoice.invoiceNumber}). Finish or cancel it first.`
    );
  }

  const tenant = await Tenant.findById(req.tenantId).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const currentPlan = await Plan.findOne({ code: tenant.planCode }).lean();
  const now = new Date();
  const isExpired = !tenant.expiresAt || new Date(tenant.expiresAt).getTime() < now.getTime();
  const isUpgrade = !isExpired && currentPlan && currentPlan.code !== newPlan.code;

  const cycle = newPlan.price?.interval || 'month';
  const currency = newPlan.price?.currency || 'KES';
  const fullPrice = newPlan.price?.amount || 0;

  let amount = fullPrice;
  let lineItemName = `${newPlan.name} Plan`;
  let lineItemDescription = `Renewal · ${tenant.name}`;
  let purpose = 'renewal';
  let prefix = 'REN';

  if (isUpgrade) {
    purpose = 'upgrade';
    prefix = 'UPG';

    const currentPrice = currentPlan.price?.amount || 0;
    const priceDiff = Math.max(0, fullPrice - currentPrice);

    const periodEndMs = new Date(tenant.expiresAt).getTime();
    const periodStartMs = new Date(tenant.approvedAt || tenant.registeredAt || now).getTime();
    const totalWindow = Math.max(1, periodEndMs - periodStartMs);
    const remaining = Math.max(0, periodEndMs - now.getTime());
    const proratedDiff = Math.round((priceDiff * remaining) / totalWindow);

    amount = proratedDiff;

    lineItemName = `Upgrade: ${currentPlan.name} → ${newPlan.name}`;
    lineItemDescription = `Prorated difference · ${tenant.name}`;
  }

  /* ─── Free / zero-amount → activate immediately ─── */
  if (amount <= 0) {
    const plan = newPlan;
    const base = tenant.expiresAt && new Date(tenant.expiresAt) > now
      ? new Date(tenant.expiresAt)
      : now;

    tenant.planCode = plan.code;
    tenant.expiresAt = computePeriodEnd(cycle, base);
    tenant.status = 'active';
    tenant.approvedAt = now;
    tenant.approvedBy = req.user._id;
    await tenant.save();

    const sub = await Subscription.findOne({ tenantId: tenant._id });
    if (sub) {
      sub.planCode = plan.code;
      sub.cycle = cycle;
      sub.currency = currency;
      sub.amountMinor = 0;
      sub.status = cycle === 'once' ? 'perpetual' : 'active';
      sub.periodStart = base;
      sub.periodEnd = tenant.expiresAt;
      sub.autoRenew = cycle !== 'once';
      await sub.save();
    } else {
      await Subscription.create({
        tenantId: tenant._id,
        planCode: plan.code,
        cycle,
        currency,
        amountMinor: 0,
        status: cycle === 'once' ? 'perpetual' : 'active',
        periodStart: base,
        periodEnd: tenant.expiresAt,
        autoRenew: cycle !== 'once',
      });
    }

    return ok(res, {
      activated: true,
      amount: 0,
      planCode: plan.code,
      periodEnd: tenant.expiresAt,
    });
  }

  /* ─── Create invoice for paid plans ─── */
  const invoiceNumber = generateInvoiceNumber(prefix);
  const dueDate = new Date(Date.now() + 3 * 3600 * 1000);

  const instructions = await paymentInstructionsService
    .getPaymentInstructions({ amount, currency, invoiceNumber })
    .catch(() => []);

  const invoiceDoc = await Invoice.create({
    tenantId: req.tenantId,
    invoiceNumber,
    purpose,
    planCode: newPlan.code,
    customerSnapshot: {
      name: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone || null,
      address: null,
    },
    items: [
      {
        productId: null,
        name: lineItemName,
        description: lineItemDescription,
        qty: 1,
        unitPrice: amount,
        subtotal: amount,
      },
    ],
    subtotal: amount,
    discount: 0,
    tax: 0,
    total: amount,
    amountPaid: 0,
    amountDue: amount,
    currency,
    status: 'sent',
    dueDate,
    issuedAt: now,
    sentAt: now,
    notes: purpose === 'upgrade'
      ? 'Upgrade invoice. Payment due within 3 hours.'
      : 'Renewal invoice. Payment due within 3 hours.',
    paymentInstructions: instructions,
    createdBy: req.user._id,
  });

  /* ─── Email: owner confirmation ─── */
  if (req.user.email) {
    if (purpose === 'upgrade') {
      emailService
        .sendUpgradeRequestReceived({
          tenantId: req.tenantId,
          to: req.user.email,
          name: req.user.fullName,
          businessName: tenant.name,
          fromPlan: currentPlan?.name || tenant.planCode,
          toPlan: newPlan.name,
          amount,
          currency,
          invoiceNumber: invoiceDoc.invoiceNumber,
          dueDate: humanDate(dueDate),
          paymentLink: `${env.appUrl}/invoice/${invoiceDoc.invoiceNumber}`,
        })
        .catch(() => {});
    } else {
      emailService
        .sendRenewalRequestReceived({
          tenantId: req.tenantId,
          to: req.user.email,
          name: req.user.fullName,
          businessName: tenant.name,
          planName: newPlan.name,
          amount,
          currency,
          invoiceNumber: invoiceDoc.invoiceNumber,
          dueDate: humanDate(dueDate),
          paymentLink: `${env.appUrl}/invoice/${invoiceDoc.invoiceNumber}`,
        })
        .catch(() => {});
    }
  }

  /* ─── Email: admin alert ─── */
  try {
    const admins = await SuperAdmin.find({ status: 'active' }).select('email').lean();
    for (const a of admins) {
      if (purpose === 'upgrade') {
        emailService
          .sendAdminUpgradeRequested({
            to: a.email,
            businessName: tenant.name,
            ownerName: req.user.fullName,
            ownerEmail: req.user.email,
            ownerPhone: req.user.phone,
            fromPlan: currentPlan?.name || tenant.planCode,
            toPlan: newPlan.name,
            amount,
            currency,
            invoiceNumber: invoiceDoc.invoiceNumber,
            dueDate: humanDate(dueDate),
            reviewUrl: `${env.adminUrl}/invoices`,
          })
          .catch(() => {});
      } else {
        emailService
          .sendAdminRenewalRequested({
            to: a.email,
            businessName: tenant.name,
            ownerName: req.user.fullName,
            ownerEmail: req.user.email,
            ownerPhone: req.user.phone,
            planName: newPlan.name,
            amount,
            currency,
            invoiceNumber: invoiceDoc.invoiceNumber,
            dueDate: humanDate(dueDate),
            reviewUrl: `${env.adminUrl}/invoices`,
          })
          .catch(() => {});
      }
    }
  } catch {}

  return created(res, {
    invoiceNumber: invoiceDoc.invoiceNumber,
    purpose,
    planCode: newPlan.code,
    items: invoiceDoc.items,
    subtotal: invoiceDoc.subtotal,
    discount: invoiceDoc.discount,
    tax: invoiceDoc.tax,
    total: invoiceDoc.total,
    amountDue: invoiceDoc.amountDue,
    currency: invoiceDoc.currency,
    status: invoiceDoc.status,
    dueDate: invoiceDoc.dueDate,
    issuedAt: invoiceDoc.issuedAt,
    paymentInstructions: instructions,
    cycle,
    isUpgrade,
  });
});

/* ─────────────── STK PUSH ─────────────── */

const stkPush = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone) throw ApiError.badRequest('MISSING_PHONE', 'phone required');

  if (!mpesaConfig.enabled) {
    throw ApiError.unavailable('MPESA_NOT_CONFIGURED', 'M-Pesa is not configured');
  }

  const invoiceDoc = await Invoice.findOne({
    __allowGlobal: true,
    tenantId: req.tenantId,
    purpose: { $in: ['renewal', 'upgrade'] },
    approvedAt: null,
    status: { $in: ['sent', 'overdue'] },
  })
    .sort({ createdAt: -1 });

  if (!invoiceDoc) throw ApiError.notFound('INVOICE_NOT_FOUND', 'No invoice to pay');
  if (invoiceDoc.status === 'paid') {
    throw ApiError.badRequest('ALREADY_PAID', 'Invoice already paid');
  }
  if (invoiceDoc.amountDue <= 0) {
    throw ApiError.badRequest('NOTHING_DUE', 'Nothing left to pay on this invoice');
  }

  const stk = await mpesaService.initiateStkPush({
    phone,
    amount: invoiceDoc.amountDue,
    accountReference: invoiceDoc.invoiceNumber,
    description: `Subscription ${invoiceDoc.invoiceNumber}`,
  });

  await Invoice.updateOne(
    { __allowGlobal: true, _id: invoiceDoc._id },
    {
      $set: {
        stkLastRequest: {
          checkoutRequestId: stk.CheckoutRequestID,
          phone,
          requestedAt: new Date(),
        },
      },
    }
  );

  await Payment.create({
    tenantId: req.tenantId,
    purpose: 'invoice',
    invoiceId: invoiceDoc._id,
    method: 'mpesa_stk',
    amount: invoiceDoc.amountDue,
    currency: invoiceDoc.currency,
    status: 'pending',
    providerRef: stk.CheckoutRequestID,
  });

  return created(res, {
    checkoutRequestId: stk.CheckoutRequestID,
    message: stk.CustomerMessage,
  });
});

module.exports = { status, pendingInvoice, invoice, renew, stkPush };