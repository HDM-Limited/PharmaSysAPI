const { asyncHandler } = require('../../utils/asyncHandler');
const { logger } = require('../../utils/logger');
const { env } = require('../../config/env');
const mpesaService = require('../../services/mpesaService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const Payment = require('../../models/client/Payment');
const Invoice = require('../../models/client/Invoice');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const SuperAdmin = require('../../models/admin/SuperAdmin');
const Plan = require('../../models/admin/Plan');

/* ─────────────── NOTIFY OWNER ─────────────── */

async function notifyOwnerPaid(invoice, method, reference) {
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

    const plan = await Plan.findOne({ code: tenant?.planCode }).lean();

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
          planName: plan?.name || tenant?.planCode,
          planLimits: plan?.limits,
          planFeatures: plan?.features,
          startDate: new Date().toLocaleDateString('en-KE', { dateStyle: 'medium' }),
          endDate: tenant?.expiresAt
            ? new Date(tenant.expiresAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })
            : null,
          trialDays: plan?.trialDays || 0,
          interval: plan?.price?.interval || 'month',
        })
        .catch((err) => logger.warn({ err: err.message }, 'owner payment email failed'));
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
  } catch (err) {
    logger.error({ err: err.message, invoiceNumber: invoice.invoiceNumber }, 'notifyOwnerPaid failed');
  }
}

/* ─────────────── NOTIFY ADMINS ─────────────── */

async function notifyAdminsPaid(invoice, method, reference) {
  try {
    const admins = await SuperAdmin.find({ status: 'active' }).select('email').lean();
    if (!admins.length) return;

    const tenant = await Tenant.findById(invoice.tenantId).select('name planCode registeredAt').lean();
    const owner = await User.findOne({
      __allowGlobal: true,
      tenantId: invoice.tenantId,
      role: 'owner',
    }).select('fullName email phone').lean();

    const daysSince = tenant?.registeredAt
      ? Math.floor((Date.now() - new Date(tenant.registeredAt).getTime()) / 86_400_000)
      : undefined;

    const reviewUrl = `${env.adminUrl}/pending`;

    for (const admin of admins) {
      emailService
        .sendAdminPaymentReceived({
          to: admin.email,
          businessName: tenant?.name || '—',
          ownerName: owner?.fullName || '—',
          ownerEmail: owner?.email || '—',
          ownerPhone: owner?.phone || null,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amountPaid,
          currency: invoice.currency,
          paidAt: invoice.paidAt?.toISOString() || new Date().toISOString(),
          paymentMethod: method,
          paymentReference: reference || null,
          planName: null,
          planCode: tenant?.planCode,
          daysSinceRegistration: daysSince,
          reviewUrl,
        })
        .catch((err) =>
          logger.warn({ err: err.message, admin: admin.email }, 'admin payment email failed')
        );
    }

    logger.info({ admins: admins.length, invoiceNumber: invoice.invoiceNumber }, 'admin payment notifications sent');
  } catch (err) {
    logger.error({ err: err.message }, 'notifyAdminsPaid failed');
  }
}

/* ─────────────── MPESA CALLBACK ─────────────── */

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
      logger.warn({ paymentId: String(payment._id) }, 'payment already final');
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

        await notifyOwnerPaid(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
        await notifyAdminsPaid(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
      }
    }
  } else {
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

      await notifyOwnerPaid(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
      await notifyAdminsPaid(invoice, 'mpesa_stk', parsed.mpesaReceiptNumber);
    } else {
      logger.warn({ checkoutRequestId: parsed.checkoutRequestId }, 'no payment or invoice matched');
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

module.exports = { mpesaCallback, mpesaTimeout, stripeWebhook };