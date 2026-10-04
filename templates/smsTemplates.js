const MAX_SMS = 160;

function truncate(s = '', max = MAX_SMS) {
  const str = String(s);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function money(amount, currency = 'KES') {
  const n = Number(amount || 0);
  return `${currency} ${n.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function brandName(brand) {
  return brand?.name || 'PharmaSys';
}

const verification = ({ code, brand }) =>
  truncate(`${brandName(brand)}: Your verification code is ${code}. Expires in 10 minutes.`);

const passwordReset = ({ resetUrl, brand }) =>
  truncate(`${brandName(brand)}: Reset your password here: ${resetUrl}`);

const passwordChanged = ({ brand }) =>
  truncate(`${brandName(brand)}: Your password was just changed. If this wasn't you, contact support immediately.`);

const welcome = ({ businessName, loginUrl, brand }) =>
  truncate(`${brandName(brand)}: ${businessName} is now active. Log in: ${loginUrl}`);

const staffWelcome = ({ businessName, role, loginUrl, brand }) =>
  truncate(`${brandName(brand)}: You've been added to ${businessName} as ${role}. Log in: ${loginUrl}`);

const paymentReceived = ({ invoiceNumber, amount, currency, brand }) =>
  truncate(`${brandName(brand)}: Payment of ${money(amount, currency)} received for ${invoiceNumber}. Thank you.`);

const subscriptionExpiring = ({ planName, daysLeft, renewUrl, brand }) =>
  truncate(`${brandName(brand)}: Your ${planName} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew: ${renewUrl}`);

const subscriptionExpired = ({ planName, renewUrl, brand }) =>
  truncate(`${brandName(brand)}: Your ${planName} subscription has expired. Renew now: ${renewUrl}`);

const subscriptionFailed = ({ planName, retryUrl, brand }) =>
  truncate(`${brandName(brand)}: Payment for ${planName} failed. Retry: ${retryUrl}`);

const subscriptionRenewed = ({ planName, periodEnd, brand }) =>
  truncate(`${brandName(brand)}: ${planName} renewed successfully. Valid until ${periodEnd}.`);

const prescriptionReady = ({ patientName, prescriptionRef, branchName, brand }) =>
  truncate(`${brandName(brand)}: Hi ${patientName}, your prescription ${prescriptionRef} is ready for pickup${branchName ? ` at ${branchName}` : ''}.`);

const refillReminder = ({ patientName, drugName, brand }) =>
  truncate(`${brandName(brand)}: Hi ${patientName}, it's time to refill ${drugName}. Visit us to collect.`);

const lowStockAlert = ({ productName, qty, brand }) =>
  truncate(`${brandName(brand)}: Low stock alert — ${productName} is down to ${qty}. Restock soon.`);

const outOfStock = ({ productName, brand }) =>
  truncate(`${brandName(brand)}: ${productName} is out of stock.`);

const expiryAlert = ({ count, daysLeft, brand }) =>
  truncate(`${brandName(brand)}: ${count} batch${count === 1 ? '' : 'es'} expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Check the app.`);

const adminRenewalRequested = ({ businessName, planName, brand }) =>
  truncate(`${brandName(brand)} ADMIN: Renewal request from ${businessName} for ${planName}. Review in admin panel.`);

const adminRenewalPaymentReceived = ({ businessName, amount, currency, brand }) =>
  truncate(`${brandName(brand)} ADMIN: Renewal payment ${money(amount, currency)} received from ${businessName}. Approve in admin panel.`);

const adminNewPending = ({ businessName, brand }) =>
  truncate(`${brandName(brand)} ADMIN: New pending registration — ${businessName}. Review in admin panel.`);

const adminServiceDown = ({ service, brand }) =>
  truncate(`${brandName(brand)} ALERT: ${service} is down. Check admin health page.`);

const adminBackupFailed = ({ brand }) =>
  truncate(`${brandName(brand)} ALERT: Backup failed. Check admin backups page.`);

const dailySummaryOwner = ({ totalSales, currency, transactions, brand }) =>
  truncate(`${brandName(brand)}: Today ${money(totalSales, currency)} across ${transactions} sales. View insights in the app.`);

const renewalRequestReceived = ({ planName, brand }) =>
  truncate(`${brandName(brand)}: We received your renewal request for ${planName}. Pay to activate.`);

const renewalInvoiceIssued = ({ invoiceNumber, amount, currency, payUrl, brand }) =>
  truncate(`${brandName(brand)}: Renewal invoice ${invoiceNumber} for ${money(amount, currency)}. Pay: ${payUrl}`);

const renewalApproved = ({ planName, periodEnd, brand }) =>
  truncate(`${brandName(brand)}: Renewal approved! ${planName} active until ${periodEnd}. Thank you.`);

const renewalRejected = ({ planName, brand }) =>
  truncate(`${brandName(brand)}: Your renewal request for ${planName} was declined. Contact support.`);

module.exports = {
  verification,
  passwordReset,
  passwordChanged,
  welcome,
  staffWelcome,

  paymentReceived,
  subscriptionExpiring,
  subscriptionExpired,
  subscriptionFailed,
  subscriptionRenewed,

  renewalRequestReceived,
  renewalInvoiceIssued,
  renewalApproved,
  renewalRejected,

  prescriptionReady,
  refillReminder,

  lowStockAlert,
  outOfStock,
  expiryAlert,

  dailySummaryOwner,

  adminRenewalRequested,
  adminRenewalPaymentReceived,
  adminNewPending,
  adminServiceDown,
  adminBackupFailed,
};