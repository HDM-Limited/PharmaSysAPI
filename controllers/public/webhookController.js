const { asyncHandler } = require('../../utils/asyncHandler');
const { logger } = require('../../utils/logger');
const mpesaService = require('../../services/mpesaService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const Payment = require('../../models/client/Payment');
const Invoice = require('../../models/client/Invoice');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');

/* ─────────────── helpers ─────────────── */

async function notifyInvoicePaid(invoice, method, reference) {
  try {
    const tenant = await Tenant.findById(invoice.tenantId).lean();
    const owner = await User.findOne({
      __allowGlobal: true,
      tenantId: invoice.tenantId,
      role: 'owner',
    })
      .select('email phone fullName')
      .lean();

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
          notes: null,
        })
        .catch((err) =>
          logger.warn({ err: err.message, invoiceNumber: invoice.invoiceNumber }, 'paymentReceived email failed')
        );
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

    logger.info(
      { invoiceNumber: invoice.invoiceNumber, method, reference },
      'paymentReceived notification sent'
    );
  } catch (err) {
    logger.error(
      { err: err.message, invoiceNumber: invoice.invoiceNumber },
      'paymentReceived notification error'
    );
  }
}

/* ─────────────── mpesa callback ─────────────── */

const mpesaCallback = asyncHandler(async (req, res) => {
  const parsed = mpesaService.parseCallback(req.body);

  logger.info(
    {
      checkoutRequestId: parsed.checkoutRequestId,
      success: parsed.success,
      receipt: parsed.mpesaReceiptNumber,
    },
    'mpesa callback parsed'
  );

  if (!parsed.checkoutRequestId) {
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  const payment = await Payment.findOne({
    __allowGlobal: true,
    providerRef: parsed.checkoutRequestId,
  });

  if (payment) {
    if (payment.status === 'success' || payment.status === 'failed') {
      logger.warn({ paymentId: String(payment._id), status: payment.status }, 'payment already final');
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
      const invoice = await Invoice.findOne({
        __allowGlobal: true,
        _id: payment.invoiceId,
      });
      if (invoice && invoice.status !== 'paid') {
        invoice.status = 'paid';
        invoice.amountPaid = invoice.total;
        invoice.amountDue = 0;
        invoice.paidAt = new Date();
        invoice.paymentMethod = 'mpesa_stk';
        invoice.paymentRef = parsed.mpesaReceiptNumber || null;
        await invoice.save();

        await notifyInvoicePaid(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
      }
    }
  } else {
    // Fallback: find invoice by stkLastRequest
    const invoice = await Invoice.findOne({
      __allowGlobal: true,
      'stkLastRequest.checkoutRequestId': parsed.checkoutRequestId,
    });

    if (invoice && parsed.success && invoice.status !== 'paid') {
      invoice.status = 'paid';
      invoice.amountPaid = invoice.total;
      invoice.amountDue = 0;
      invoice.paidAt = new Date();
      invoice.paymentMethod = 'mpesa_stk';
      invoice.paymentRef = parsed.mpesaReceiptNumber || null;
      await invoice.save();

      await notifyInvoicePaid(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
    } else {
      logger.warn(
        { checkoutRequestId: parsed.checkoutRequestId },
        'no payment or invoice matched the callback'
      );
    }
  }

  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

const mpesaTimeout = asyncHandler(async (req, res) => {
  logger.warn({ body: req.body }, 'mpesa timeout');
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

const stripeWebhook = asyncHandler(async (req, res) => {
  logger.info('stripe webhook received');
  return res.status(200).json({ received: true });
});

module.exports = {
  mpesaCallback,
  mpesaTimeout,
  stripeWebhook,
};