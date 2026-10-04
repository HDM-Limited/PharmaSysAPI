const cron = require('node-cron');
const Invoice = require('../models/client/Invoice');
const Tenant = require('../models/admin/Tenant');
const User = require('../models/client/User');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const notificationService = require('../services/notificationService');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

async function run() {
  const now = new Date();

  const invoices = await Invoice.find({
    __allowGlobal: true,
    status: { $in: ['sent', 'overdue'] },
    dueDate: { $lt: now },
    amountDue: { $gt: 0 },
  }).lean();

  let notified = 0;

  for (const invoice of invoices) {
    const daysOverdue = Math.floor((now - new Date(invoice.dueDate)) / 86_400_000);

    if (invoice.status !== 'overdue') {
      await Invoice.updateOne({ _id: invoice._id }, { $set: { status: 'overdue' } }).catch(() => {});
    }

    const tenant = await Tenant.findById(invoice.tenantId).select('name').lean();
    const owner = await User.findOne({
      __allowGlobal: true,
      tenantId: invoice.tenantId,
      role: 'owner',
    }).select('_id email phone fullName').lean();

    if (!owner) continue;

    const paymentLink = `${env.appUrl}/invoice/${invoice.invoiceNumber}`;

    notificationService
      .create({
        tenantId: invoice.tenantId,
        userId: owner._id,
        type: 'error',
        title: `Invoice ${invoice.invoiceNumber} overdue`,
        body: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue — ${invoice.currency} ${invoice.amountDue}`,
        link: '/app/billing',
      })
      .catch(() => {});

    if (owner.email) {
      emailService
        .sendInvoiceOverdue({
          tenantId: invoice.tenantId,
          to: owner.email,
          businessName: tenant?.name || 'PharmaSys',
          customerName: owner.fullName,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.amountDue,
          currency: invoice.currency,
          daysOverdue,
          paymentLink,
        })
        .catch(() => {});
    }

    if (owner.phone && daysOverdue >= 3) {
      smsService
        .sendGeneric({
          tenantId: invoice.tenantId,
          to: owner.phone,
          content: `PharmaSys: Invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue. Pay: ${paymentLink}`,
          template: 'invoice_overdue',
        })
        .catch(() => {});
    }

    notified++;
  }

  logger.info({ notified }, 'overdue invoices scan complete');
  return { notified };
}

function start() {
  task = cron.schedule('0 8 * * *', () => {
    run().catch((err) => logger.error({ err: err.message }, 'overdue invoice scan failed'));
  }, { timezone: TZ });
  logger.info('overdue-invoices scheduler started');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'overdueInvoices', start, stop, run };