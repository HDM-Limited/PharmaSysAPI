const crypto = require('crypto');

function generateInvoiceNumber(prefix = 'INV') {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${yyyy}${mm}${dd}-${rand}`;
}

module.exports = { generateInvoiceNumber };