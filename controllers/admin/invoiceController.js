const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { env } = require('../../config/env');

const Invoice = require('../../models/client/Invoice');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const adminActionService = require('../../services/adminActionService');
const invoiceService = require('../../services/invoiceService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.tenantId) filter.tenantId = req.query.tenantId;
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ]);

  return paginated(res, items, page, limit, total);
});

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const invoice = await Invoice.findById(req.params.id).lean();
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  return ok(res, invoice);
});

const markPaid = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const { method, reference = null, note = null } = req.body;
  if (!method) throw ApiError.badRequest('METHOD_REQUIRED', 'Payment method required');

  const invoice = await invoiceService.markPaid({ invoiceId: req.params.id, method, reference });
  if (note) {
    invoice.notes = `${invoice.notes || ''}\nAdmin note: ${note}`.trim();
    await invoice.save();
  }

  const tenant = await Tenant.findById(invoice.tenantId).lean();
  const owner = await User.findOne({ tenantId: invoice.tenantId, role: 'owner' }).lean();

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
        paidAt: invoice.paidAt.toISOString(),
        paymentMethod: method,
        paymentReference: reference,
        notes: note,
      })
      .catch(() => {});
  }

  if (owner?.phone) {
    smsService
      .sendPaymentReceived({
        tenantId: invoice.tenantId,
        to: owner.phone,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amountPaid,
        currency: invoice.currency,
      })
      .catch(() => {});
  }

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: invoice.tenantId,
    action: 'invoice.mark_paid',
    metadata: { invoiceNumber: invoice.invoiceNumber, method, reference },
    ip: req.ip,
  });

  return ok(res, invoice.toObject());
});

const cancel = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const { reason = null } = req.body;

  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  if (invoice.status === 'paid') throw ApiError.badRequest('ALREADY_PAID', 'Cannot cancel a paid invoice');

  invoice.status = 'cancelled';
  invoice.notes = `${invoice.notes || ''}\nCancelled: ${reason || 'no reason'}`.trim();
  await invoice.save();

  const tenant = await Tenant.findById(invoice.tenantId).lean();
  const owner = await User.findOne({ tenantId: invoice.tenantId, role: 'owner' }).lean();

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

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: invoice.tenantId,
    action: 'invoice.cancel',
    reason,
    ip: req.ip,
  });

  return ok(res, invoice.toObject());
});

const resend = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invoiceId');
  const invoice = await Invoice.findById(req.params.id).lean();
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');

  const [tenant, owner] = await Promise.all([
    Tenant.findById(invoice.tenantId).lean(),
    User.findOne({ tenantId: invoice.tenantId, role: 'owner' }).lean(),
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

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: invoice.tenantId,
    action: 'invoice.resend',
    metadata: { invoiceNumber: invoice.invoiceNumber },
    ip: req.ip,
  });

  return ok(res, { resent: true });
});

module.exports = { list, get, markPaid, cancel, resend };