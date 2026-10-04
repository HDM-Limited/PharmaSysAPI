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

/* ─────────────── RENEW ─────────────── */

const renew = asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can renew the subscription');
  }

  const { planCode } = req.body;
  if (!planCode) throw ApiError.badRequest('MISSING_PLAN', 'planCode required');

  const plan = await Plan.findOne({ code: planCode, isActive: true }).lean();
  if (!plan) throw ApiError.badRequest('INVALID_PLAN', `Plan '${planCode}' not available`);

  const tenant = await Tenant.findById(req.tenantId).select('name planCode').lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const cycle = plan.price?.interval || 'month';
  const currency = plan.price?.currency || 'KES';
  const amount = plan.price?.amount || 0;
  const dueDate = new Date(Date.now() + 3 * 3600 * 1000);
  const invoiceNumber = generateInvoiceNumber('REN');

  // Build payment instructions from enabled methods
  const instructions = await paymentInstructionsService.getPaymentInstructions({
    amount,
    currency,
    invoiceNumber,
  });

  const invoice = await Invoice.create({
    tenantId: req.tenantId,
    invoiceNumber,
    customerSnapshot: {
      name: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone || null,
      address: null,
    },
    items: [
      {
        productId: null,
        name: `${plan.name} Plan`,
        description: `Renewal · ${tenant.name}`,
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
    issuedAt: new Date(),
    sentAt: new Date(),
    notes: 'Renewal invoice. Payment due within 3 hours.',
    paymentInstructions: instructions,
    createdBy: req.user._id,
  });

  if (req.user.email) {
    emailService
      .sendInvoice({
        tenantId: req.tenantId,
        to: req.user.email,
        businessName: tenant.name,
        customerName: req.user.fullName,
        invoiceNumber: invoice.invoiceNumber,
        items: invoice.items,
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        tax: invoice.tax,
        total: invoice.total,
        amountDue: invoice.amountDue,
        currency: invoice.currency,
        dueDate: invoice.dueDate.toISOString(),
        issuedAt: invoice.issuedAt.toISOString(),
        notes: invoice.notes,
        instructions: instructions,
        payUrl: `${env.appUrl}/invoice/${invoice.invoiceNumber}`,
      })
      .catch(() => {});
  }

  return created(res, {
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    amountDue: invoice.amountDue,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    planCode: plan.code,
    cycle,
  });
});

/* ─────────────── INVOICE (read latest) ─────────────── */

const invoice = asyncHandler(async (req, res) => {
  const latest = await Invoice.findOne({ __allowGlobal: true, tenantId: req.tenantId })
    .sort({ createdAt: -1 })
    .lean();

  if (!latest) return ok(res, null);

  return ok(res, {
    invoiceNumber: latest.invoiceNumber,
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
    notes: latest.notes,
    paymentInstructions: latest.paymentInstructions || [],
  });
});

/* ─────────────── STK PUSH ─────────────── */

const stkPush = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone) throw ApiError.badRequest('MISSING_PHONE', 'phone required');

  if (!mpesaConfig.enabled) {
    throw ApiError.unavailable('MPESA_NOT_CONFIGURED', 'M-Pesa is not configured');
  }

  const invoiceDoc = await Invoice.findOne({ __allowGlobal: true, tenantId: req.tenantId })
    .sort({ createdAt: -1 });
  if (!invoiceDoc) throw ApiError.notFound('INVOICE_NOT_FOUND', 'No invoice to pay');
  if (invoiceDoc.status === 'paid') {
    throw ApiError.badRequest('ALREADY_PAID', 'Invoice already paid');
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

module.exports = { status, renew, invoice, stkPush };