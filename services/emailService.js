const hdmBridge = require('../config/hdmBridge');
const Notification = require('../models/client/Notification');
const settingsService = require('./settingsService');
const emailTemplates = require('../templates/emailTemplates');
const { logger } = require('../utils/logger');

async function getBrand() {
  return settingsService.getBrand();
}

async function send({
  tenantId = null,
  scope = null,
  recipientId = null,
  to,
  subject,
  html,
  text,
  template = 'generic',
}) {
  if (!to) throw new Error('emailService.send: "to" is required');
  if (!subject) throw new Error('emailService.send: "subject" is required');

  const resolvedScope = scope || (tenantId ? 'tenant' : 'system');

  let result = null;
  let error = null;

  try {
    result = await hdmBridge.sendEmail({
      to,
      subject,
      htmlBody: html || '',
      textBody: text || '',
    });
  } catch (e) {
    error = e;
  }

  try {
    await Notification.create({
      scope: resolvedScope,
      tenantId: tenantId || null,
      recipientId: recipientId || null,
      channel: 'email',
      template,
      to,
      subject,
      body: text || html || '',
      status: error ? 'failed' : 'sent',
      providerMessageId: result?.messageId || null,
      error: error ? error.message : null,
      errorCode: error?.response?.status ? String(error.response.status) : null,
      sentAt: error ? null : new Date(),
    });
  } catch (logErr) {
    logger.warn({ err: logErr.message }, 'notification log failed (email)');
  }

  if (error) throw error;
  return result;
}

async function renderAndSend(templateFn, templateKey, { tenantId = null, scope = null, recipientId = null, to, data = {} }) {
  if (!to) return null;
  const brand = await getBrand();
  const tpl = templateFn({ brand, ...data });
  return send({ tenantId, scope, recipientId, to, ...tpl, template: templateKey });
}

/* ─── AUTH ─── */

const sendVerification = ({ tenantId, recipientId, to, name, verifyUrl, expiresIn }) =>
  renderAndSend(emailTemplates.verification, 'verification', { tenantId, recipientId, to, data: { name, verifyUrl, expiresIn } });

const sendPasswordReset = ({ tenantId, recipientId, to, fullName, resetUrl, expiresIn }) =>
  renderAndSend(emailTemplates.passwordReset, 'password_reset', { tenantId, recipientId, to, data: { fullName, resetUrl, expiresIn } });

const sendPasswordChanged = ({ tenantId, recipientId, to, fullName, when, ip }) =>
  renderAndSend(emailTemplates.passwordChanged, 'password_changed', { tenantId, recipientId, to, data: { fullName, when, ip } });

const sendWelcome = ({ tenantId, recipientId, to, name, businessName, email, temporaryPassword, loginUrl, planName, planLimits, planFeatures, startDate, endDate, trialDays, amount, currency, interval }) =>
  renderAndSend(emailTemplates.welcome, 'welcome', {
    tenantId, recipientId, to,
    data: { name, businessName, email, temporaryPassword, loginUrl, planName, planLimits, planFeatures, startDate, endDate, trialDays, amount, currency, interval },
  });

const sendStaffWelcome = ({ tenantId, recipientId, to, fullName, businessName, email, temporaryPassword, role, loginUrl }) =>
  renderAndSend(emailTemplates.staffWelcome, 'staff_welcome', { tenantId, recipientId, to, data: { fullName, businessName, email, temporaryPassword, role, loginUrl } });

const sendStaffDeactivated = ({ tenantId, recipientId, to, fullName, businessName }) =>
  renderAndSend(emailTemplates.staffDeactivated, 'staff_deactivated', { tenantId, recipientId, to, data: { fullName, businessName } });

const sendRoleChanged = ({ tenantId, recipientId, to, fullName, businessName, oldRole, newRole }) =>
  renderAndSend(emailTemplates.roleChanged, 'role_changed', { tenantId, recipientId, to, data: { fullName, businessName, oldRole, newRole } });

/* ─── REGISTRATION ─── */

const sendRegistrationReceived = ({ tenantId, recipientId, to, name, businessName, planName, amount, currency, dueDate, invoiceNumber, paymentLink }) =>
  renderAndSend(emailTemplates.registrationReceived, 'registration_received', { tenantId, recipientId, to, data: { name, businessName, planName, amount, currency, dueDate, invoiceNumber, paymentLink } });

const sendRegistrationRejected = ({ tenantId, recipientId, to, name, businessName, reason }) =>
  renderAndSend(emailTemplates.registrationRejected, 'registration_rejected', { tenantId, recipientId, to, data: { name, businessName, reason } });

const sendTenantReactivated = ({ tenantId, recipientId, to, fullName, businessName, loginUrl }) =>
  renderAndSend(emailTemplates.tenantReactivated, 'tenant_reactivated', { tenantId, recipientId, to, data: { fullName, businessName, loginUrl } });

/* ─── BILLING ─── */

const sendInvoice = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.invoice, 'invoice', { tenantId, to, data });

const sendPaymentReceived = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.paymentReceived, 'payment_received', { tenantId, to, data });

const sendInvoiceReminder = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.invoiceReminder, 'invoice_reminder', { tenantId, to, data });

const sendInvoiceOverdue = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.invoiceOverdue, 'invoice_overdue', { tenantId, to, data });

const sendInvoiceCancelled = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.invoiceCancelled, 'invoice_cancelled', { tenantId, to, data });

const sendPaymentRefunded = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.paymentRefunded, 'payment_refunded', { tenantId, to, data });

const sendSubscriptionPaid = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.subscriptionPaid, 'subscription_paid', { tenantId, to, data });

const sendSubscriptionExpiring = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.subscriptionExpiring, 'subscription_expiring', { tenantId, to, data });

const sendSubscriptionExpired = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.subscriptionExpired, 'subscription_expired', { tenantId, to, data });

const sendSubscriptionFailed = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.subscriptionFailed, 'subscription_failed', { tenantId, to, data });

const sendPlanUpgraded = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.planUpgraded, 'plan_upgraded', { tenantId, to, data });

const sendPlanCancelled = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.planCancelled, 'plan_cancelled', { tenantId, to, data });

/* ─── ADMIN ─── */

const sendAdminWelcome = ({ to, recipientId = null, ...data }) =>
  renderAndSend(emailTemplates.adminWelcome, 'admin_welcome', { tenantId: null, scope: 'admin', recipientId, to, data });

const sendAdminNewPending = ({ to, ...data }) =>
  renderAndSend(emailTemplates.adminNewPending, 'admin_new_pending', { tenantId: null, scope: 'admin', to, data });

const sendAdminPaymentReceived = ({ to, ...data }) =>
  renderAndSend(emailTemplates.adminPaymentReceived, 'admin_payment_received', { tenantId: null, scope: 'admin', to, data });

const sendAdminServiceDown = ({ to, ...data }) =>
  renderAndSend(emailTemplates.adminServiceDown, 'admin_service_down', { tenantId: null, scope: 'admin', to, data });

const sendAdminBackupFailed = ({ to, ...data }) =>
  renderAndSend(emailTemplates.adminBackupFailed, 'admin_backup_failed', { tenantId: null, scope: 'admin', to, data });

const sendAdminBackupSuccess = ({ to, ...data }) =>
  renderAndSend(emailTemplates.adminBackupSuccess, 'admin_backup_success', { tenantId: null, scope: 'admin', to, data });

const sendAdminRestoreComplete = ({ to, ...data }) =>
  renderAndSend(emailTemplates.adminRestoreComplete, 'admin_restore_complete', { tenantId: null, scope: 'admin', to, data });

/* ─── PHARMA ─── */

const sendLowStockAlert = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.lowStockAlert, 'low_stock_alert', { tenantId, to, data });

const sendOutOfStock = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.outOfStock, 'out_of_stock', { tenantId, to, data });

const sendExpiryAlert = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.expiryAlert, 'expiry_alert', { tenantId, to, data });

const sendPrescriptionReady = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.prescriptionReady, 'prescription_ready', { tenantId, to, data });

/* ─── REPORTS ─── */

const sendDailySummary = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.dailySummary, 'daily_summary', { tenantId, to, data });

const sendWeeklyReport = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.weeklyReport, 'weekly_report', { tenantId, to, data });

/* ─── SUPPLIER ─── */

const sendPurchaseOrder = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.purchaseOrder, 'purchase_order', { tenantId, to, data });

const sendPurchaseOrderCancelled = ({ tenantId, to, ...data }) =>
  renderAndSend(emailTemplates.purchaseOrderCancelled, 'purchase_order_cancelled', { tenantId, to, data });

/* ─── GENERIC ─── */

const sendGeneric = ({ tenantId = null, scope = null, recipientId = null, to, subject, html, text, template = 'generic' }) =>
  send({ tenantId, scope, recipientId, to, subject, html, text, template });

module.exports = {
  send,
  getBrand,
  sendGeneric,

  sendVerification,
  sendPasswordReset,
  sendPasswordChanged,
  sendWelcome,
  sendStaffWelcome,
  sendStaffDeactivated,
  sendRoleChanged,

  sendRegistrationReceived,
  sendRegistrationRejected,
  sendTenantReactivated,

  sendInvoice,
  sendPaymentReceived,
  sendInvoiceReminder,
  sendInvoiceOverdue,
  sendInvoiceCancelled,
  sendPaymentRefunded,
  sendSubscriptionPaid,
  sendSubscriptionExpiring,
  sendSubscriptionExpired,
  sendSubscriptionFailed,
  sendPlanUpgraded,
  sendPlanCancelled,

  sendAdminWelcome,
  sendAdminNewPending,
  sendAdminPaymentReceived,
  sendAdminServiceDown,
  sendAdminBackupFailed,
  sendAdminBackupSuccess,
  sendAdminRestoreComplete,

  sendLowStockAlert,
  sendOutOfStock,
  sendExpiryAlert,
  sendPrescriptionReady,

  sendDailySummary,
  sendWeeklyReport,

  sendPurchaseOrder,
  sendPurchaseOrderCancelled,
};