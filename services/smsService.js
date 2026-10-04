const hdmBridge = require('../config/hdmBridge');
const Notification = require('../models/client/Notification');
const settingsService = require('./settingsService');
const smsTemplates = require('../templates/smsTemplates');
const { normalizePhone } = require('../utils/phone');
const { logger } = require('../utils/logger');

async function send({
  tenantId = null,
  scope = null,
  recipientId = null,
  to,
  content,
  template = 'generic',
}) {
  if (!to) throw new Error('smsService.send: "to" is required');
  if (!content) throw new Error('smsService.send: "content" is required');

  const phone = normalizePhone(to);
  const resolvedScope = scope || (tenantId ? 'tenant' : 'system');

  let result = null;
  let error = null;

  try {
    result = await hdmBridge.sendSms({ to: phone, content });
  } catch (e) {
    error = e;
  }

  try {
    await Notification.create({
      scope: resolvedScope,
      tenantId: tenantId || null,
      recipientId: recipientId || null,
      channel: 'sms',
      template,
      to: phone,
      body: content,
      status: error ? 'failed' : result?.status === 'sent' ? 'sent' : 'failed',
      providerMessageId: result?.messageId || null,
      creditsUsed: result?.creditsUsed || 0,
      error: error ? error.message : null,
      errorCode: error?.response?.status ? String(error.response.status) : null,
      sentAt: error ? null : new Date(),
    });
  } catch (logErr) {
    logger.warn({ err: logErr.message }, 'notification log failed (sms)');
  }

  if (error) throw error;
  return result;
}

async function renderAndSend(templateFn, templateKey, { tenantId = null, scope = null, recipientId = null, to, data = {} }) {
  if (!to) return null;
  const brand = await settingsService.getBrand();
  const content = templateFn({ brand, ...data });
  return send({ tenantId, scope, recipientId, to, content, template: templateKey });
}

const sendVerification = ({ tenantId, recipientId, to, code }) =>
  renderAndSend(smsTemplates.verification, 'verification', { tenantId, recipientId, to, data: { code } });

const sendPasswordReset = ({ tenantId, recipientId, to, resetUrl }) =>
  renderAndSend(smsTemplates.passwordReset, 'password_reset', { tenantId, recipientId, to, data: { resetUrl } });

const sendPasswordChanged = ({ tenantId, recipientId, to }) =>
  renderAndSend(smsTemplates.passwordChanged, 'password_changed', { tenantId, recipientId, to, data: {} });

const sendWelcome = ({ tenantId, recipientId, to, businessName, loginUrl }) =>
  renderAndSend(smsTemplates.welcome, 'welcome', { tenantId, recipientId, to, data: { businessName, loginUrl } });

const sendStaffWelcome = ({ tenantId, recipientId, to, businessName, role, loginUrl }) =>
  renderAndSend(smsTemplates.staffWelcome, 'staff_welcome', { tenantId, recipientId, to, data: { businessName, role, loginUrl } });

const sendPaymentReceived = ({ tenantId, recipientId, to, invoiceNumber, amount, currency }) =>
  renderAndSend(smsTemplates.paymentReceived, 'payment_received', { tenantId, recipientId, to, data: { invoiceNumber, amount, currency } });

const sendSubscriptionExpiring = ({ tenantId, recipientId, to, planName, daysLeft, renewUrl }) =>
  renderAndSend(smsTemplates.subscriptionExpiring, 'subscription_expiring', { tenantId, recipientId, to, data: { planName, daysLeft, renewUrl } });

const sendSubscriptionExpired = ({ tenantId, recipientId, to, planName, renewUrl }) =>
  renderAndSend(smsTemplates.subscriptionExpired, 'subscription_expired', { tenantId, recipientId, to, data: { planName, renewUrl } });

const sendSubscriptionFailed = ({ tenantId, recipientId, to, planName, retryUrl }) =>
  renderAndSend(smsTemplates.subscriptionFailed, 'subscription_failed', { tenantId, recipientId, to, data: { planName, retryUrl } });

const sendPrescriptionReady = ({ tenantId, recipientId, to, patientName, prescriptionRef, branchName }) =>
  renderAndSend(smsTemplates.prescriptionReady, 'prescription_ready', { tenantId, recipientId, to, data: { patientName, prescriptionRef, branchName } });

const sendLowStockAlert = ({ tenantId, recipientId, to, productName, qty }) =>
  renderAndSend(smsTemplates.lowStockAlert, 'low_stock_alert', { tenantId, recipientId, to, data: { productName, qty } });

const sendAdminNewPending = ({ to, businessName }) =>
  renderAndSend(smsTemplates.adminNewPending, 'admin_new_pending', { tenantId: null, scope: 'admin', to, data: { businessName } });

const sendAdminServiceDown = ({ to, service }) =>
  renderAndSend(smsTemplates.adminServiceDown, 'admin_service_down', { tenantId: null, scope: 'admin', to, data: { service } });

const sendAdminBackupFailed = ({ to }) =>
  renderAndSend(smsTemplates.adminBackupFailed, 'admin_backup_failed', { tenantId: null, scope: 'admin', to, data: {} });

const sendGeneric = ({ tenantId = null, scope = null, recipientId = null, to, content, template = 'generic' }) =>
  send({ tenantId, scope, recipientId, to, content, template });

module.exports = {
  send,
  sendGeneric,
  sendVerification,
  sendPasswordReset,
  sendPasswordChanged,
  sendWelcome,
  sendStaffWelcome,
  sendPaymentReceived,
  sendSubscriptionExpiring,
  sendSubscriptionExpired,
  sendSubscriptionFailed,
  sendPrescriptionReady,
  sendLowStockAlert,
  sendAdminNewPending,
  sendAdminServiceDown,
  sendAdminBackupFailed,
};