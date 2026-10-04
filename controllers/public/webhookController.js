const { asyncHandler } = require('../../utils/asyncHandler');
const { logger } = require('../../utils/logger');
const Payment = require('../../models/client/Payment');
const Invoice = require('../../models/client/Invoice');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const mpesaService = require('../../services/mpesaService');
const stripeService = require('../../services/stripeService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

async function notifyPaymentReceived(invoice, method, reference) {
  const tenant = await Tenant.findById(invoice.tenantId).lean();
  const owner = await User.findOne({ tenantId: invoice.tenantId, role: 'owner' }).lean();
  if (!owner) return;

  if (owner.email) {
    emailService
      .sendPaymentReceived({
        tenantId: invoice.tenantId,
        to: owner.email,
        businessName: tenant?.name || 'PharmaSys',
        customerName: owner.fullName,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amountPaid,
        currency: invoice.currency,
        paidAt: invoice.paidAt?.toISOString() || new Date().toISOString(),
        paymentMethod: method,
        paymentReference: reference || null,
      })
      .catch(() => {});
  }

  if (owner.phone) {
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
}

const mpesaCallback = asyncHandler(async (req, res) => {
  const parsed = mpesaService.parseCallback(req.body);

  logger.info(
    { checkoutRequestId: parsed.checkoutRequestId, success: parsed.success, receipt: parsed.mpesaReceiptNumber },
    'mpesa callback parsed'
  );

  if (!parsed.checkoutRequestId) {
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  const payment = await Payment.findOne({ providerRef: parsed.checkoutRequestId });

  if (payment) {
    if (payment.status === 'success' || payment.status === 'failed') {
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    payment.status = parsed.success ? 'success' : 'failed';
    payment.providerPayload = req.body;

    if (parsed.success) {
      payment.mpesaReceipt = parsed.mpesaReceiptNumber || null;
      payment.paidAt = new Date();
    } else {
      payment.failureReason = parsed.resultDesc || null;
    }

    await payment.save();

    if (parsed.success && payment.invoiceId) {
      const invoice = await Invoice.findById(payment.invoiceId);
      if (invoice && invoice.status !== 'paid') {
        invoice.status = 'paid';
        invoice.amountPaid = invoice.total;
        invoice.amountDue = 0;
        invoice.paidAt = new Date();
        invoice.paymentMethod = 'mpesa_stk';
        invoice.paymentRef = parsed.mpesaReceiptNumber || null;
        await invoice.save();

        await notifyPaymentReceived(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
      }
    }
  } else {
    const invoice = await Invoice.findOne({ 'stkLastRequest.checkoutRequestId': parsed.checkoutRequestId });
    if (invoice && parsed.success && invoice.status !== 'paid') {
      invoice.status = 'paid';
      invoice.amountPaid = invoice.total;
      invoice.amountDue = 0;
      invoice.paidAt = new Date();
      invoice.paymentMethod = 'mpesa_stk';
      invoice.paymentRef = parsed.mpesaReceiptNumber || null;
      await invoice.save();

      await notifyPaymentReceived(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
    }
  }

  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

const mpesaTimeout = asyncHandler(async (req, res) => {
  logger.warn({ body: req.body }, 'mpesa timeout');
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

const stripeWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeService.verifyWebhook(req.body, signature);
  } catch (err) {
    logger.warn({ err: err.message }, 'stripe signature verification failed');
    return res.status(400).json({ received: false });
  }

  await stripeService.handleEvent(event).catch(() => {});
  return res.status(200).json({ received: true });
});

module.exports = { mpesaCallback, mpesaTimeout, stripeWebhook };