const cron = require('node-cron');
const Tenant = require('../models/admin/Tenant');
const User = require('../models/client/User');
const Invoice = require('../models/client/Invoice');
const AppNotification = require('../models/client/AppNotification');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const { runAsTenant } = require('../models/plugins/context');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let task = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function run() {
  const now = new Date();
  const today = startOfToday();
  const tenants = await Tenant.find({ status: 'active' }).select('_id name').lean();

  let notified = 0;
  let skipped = 0;
  let failed = 0;

  for (const tenant of tenants) {
    try {
      const result = await runAsTenant({ tenantId: String(tenant._id) }, async () => {
        let innerNotified = 0;
        let innerSkipped = 0;

        const invoices = await Invoice.find({
          tenantId: tenant._id,
          status: { $in: ['sent', 'overdue'] },
          dueDate: { $lt: now },
          amountDue: { $gt: 0 },
        }).lean();

        for (const invoice of invoices) {
          const already = await AppNotification.findOne({
            tenantId: tenant._id,
            type: 'error',
            'meta.invoiceId': String(invoice._id),
            createdAt: { $gte: today },
          })
            .select('_id')
            .lean();

          const daysOverdue = Math.floor(
            (now - new Date(invoice.dueDate)) / 86_400_000
          );

          // Flip status even if we already alerted — idempotent
          if (invoice.status !== 'overdue') {
            await Invoice.updateOne(
              { _id: invoice._id },
              { $set: { status: 'overdue' } }
            ).catch(() => {});
          }

          if (already) {
            innerSkipped++;
            continue;
          }

          const owner = await User.findOne({
            tenantId: tenant._id,
            role: 'owner',
          })
            .select('_id email phone fullName')
            .lean();

          if (!owner) continue;

          const paymentLink = `${env.appUrl}/invoice/${invoice.invoiceNumber}`;

          notificationService
            .create({
              tenantId: tenant._id,
              userId: owner._id,
              type: 'error',
              title: `Invoice ${invoice.invoiceNumber} overdue`,
              body: `${daysOverdue} day${
                daysOverdue === 1 ? '' : 's'
              } overdue — ${invoice.currency} ${invoice.amountDue}`,
              link: '/app/billing',
              meta: { invoiceId: String(invoice._id), daysOverdue },
            })
            .catch(() => {});

          if (owner.email) {
            emailService
              .sendInvoiceOverdue({
                tenantId: tenant._id,
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
                tenantId: tenant._id,
                to: owner.phone,
                content: `PharmaSys: Invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue. Pay: ${paymentLink}`,
                template: 'invoice_overdue',
              })
              .catch(() => {});
          }

          innerNotified++;
        }

        return { notified: innerNotified, skipped: innerSkipped };
      });

      notified += result.notified;
      skipped += result.skipped;
    } catch (err) {
      failed++;
      logger.warn(
        { err: err.message, tenantId: String(tenant._id) },
        'overdue invoice scan failed for tenant'
      );
    }
  }

  logger.info(
    { notified, skipped, failed, tenants: tenants.length },
    'overdue invoices scan complete'
  );
  return { notified, skipped, failed };
}

function start() {
  task = cron.schedule(
    '0 8 * * *',
    () => {
      run().catch((err) =>
        logger.error({ err: err.message }, 'overdue invoice scan failed')
      );
    },
    { timezone: TZ }
  );
  logger.info('overdue-invoices scheduler started (daily, deduped)');
}

function stop() {
  task?.stop();
}

module.exports = { name: 'overdueInvoices', start, stop, run };