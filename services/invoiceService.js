const Invoice = require('../models/client/Invoice');
const { ApiError } = require('../utils/apiError');
const { logger } = require('../utils/logger');
const { generateInvoiceNumber } = require('../utils/invoiceNumber');
const paymentInstructionsService = require('./paymentInstructionsService');

const DUE_HOURS = 3;

function intervalLabel(interval) {
  if (interval === 'once') return 'One-time';
  if (interval === 'year') return 'Annual';
  return 'Monthly';
}

async function createWithRetry(data, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await Invoice.create({ ...data, invoiceNumber: data.invoiceNumber || generateInvoiceNumber() });
    } catch (err) {
      if (err.code !== 11000) throw err;
      logger.warn({ attempt: i + 1 }, 'invoice number collision, retrying');
    }
  }
  throw ApiError.internal('INVOICE_NUMBER_COLLISION', 'Could not generate unique invoice number');
}

async function generateSubscriptionInvoice({ tenantId, owner, tenant, plan, createdBy = null }) {
  if (!tenantId || !owner) throw ApiError.badRequest('MISSING_FIELDS', 'tenantId and owner required');

  const price = plan?.price || { amount: 0, currency: 'KES', interval: 'month' };
  const planName = plan?.name || 'Free';
  const label = intervalLabel(price.interval);

  const issuedAt = new Date();
  const dueDate = new Date(issuedAt.getTime() + DUE_HOURS * 60 * 60 * 1000);

  const items = [
    {
      productId: null,
      name: `${planName} Plan`,
      description: `${label} · ${tenant.name}`,
      qty: 1,
      unitPrice: price.amount,
      subtotal: price.amount,
    },
  ];

  const subtotal = price.amount;
  const total = subtotal;
  const invoiceNumber = generateInvoiceNumber();

  const instructions = await paymentInstructionsService.getPaymentInstructions({
    amount: total,
    currency: price.currency,
    invoiceNumber,
  });

  const invoice = await createWithRetry({
    tenantId,
    invoiceNumber,
    customerSnapshot: {
      name: owner.fullName,
      email: owner.email,
      phone: owner.phone || null,
      address: null,
    },
    items,
    subtotal,
    discount: 0,
    tax: 0,
    total,
    amountPaid: 0,
    amountDue: total,
    currency: price.currency,
    status: 'sent',
    dueDate,
    issuedAt,
    sentAt: issuedAt,
    notes: `Subscription invoice. Payment due within ${DUE_HOURS} hours.`,
    paymentInstructions: instructions,
    createdBy,
  });

  logger.info({ tenantId, invoiceNumber: invoice.invoiceNumber, total }, 'subscription invoice created');

  return { invoice, instructions };
}

async function markPaid({ invoiceId, method, reference = null, amountPaid = null }) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  if (invoice.status === 'paid') return invoice;

  invoice.status = 'paid';
  invoice.amountPaid = amountPaid ?? invoice.amountDue;
  invoice.amountDue = 0;
  invoice.paidAt = new Date();
  invoice.paymentMethod = method;
  invoice.paymentRef = reference;
  await invoice.save();

  return invoice;
}

async function getByNumber(invoiceNumber) {
  return Invoice.findOne({ invoiceNumber }).lean();
}

async function list({ tenantId, filter = {}, skip = 0, limit = 20 }) {
  const q = { tenantId, ...filter };
  const [items, total] = await Promise.all([
    Invoice.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(q),
  ]);
  return { items, total };
}

module.exports = {
  DUE_HOURS,
  generateSubscriptionInvoice,
  markPaid,
  getByNumber,
  list,
};