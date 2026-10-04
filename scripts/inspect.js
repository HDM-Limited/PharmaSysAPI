require('./dnsSet');
require('dotenv/config');

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  const invoices = db.collection('invoices');
  const pending  = db.collection('pendingactivations');

  const [
    regs,
    renAll, renPaid,
    upgAll, upgPaid,
    upgByStatus,
  ] = await Promise.all([
    pending.countDocuments({ status: { $in: ['pending', 'in_review'] } }),

    invoices.countDocuments({ purpose: 'renewal' }),
    invoices.countDocuments({ purpose: 'renewal', status: 'paid' }),

    invoices.countDocuments({ purpose: 'upgrade' }),
    invoices.countDocuments({ purpose: 'upgrade', status: 'paid' }),

    invoices.aggregate([
      { $match: { purpose: 'upgrade' } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  console.log('\n=== COUNTS ===');
  console.log({
    registrations: regs,
    renewals_total: renAll,
    renewals_paid: renPaid,
    upgrades_total: upgAll,
    upgrades_paid: upgPaid,
  });

  console.log('\n=== UPGRADES BY STATUS ===');
  console.log(JSON.stringify(upgByStatus, null, 2));

  console.log('\n=== LAST 5 UPGRADE INVOICES ===');
  const last5 = await invoices
    .find({ purpose: 'upgrade' })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  console.log(JSON.stringify(last5, null, 2));

  console.log('\n=== SPECIFIC INVOICE ===');
  const one = await invoices.findOne({ invoiceNumber: 'UPG-20261004-323231' });
  console.log(JSON.stringify(one, null, 2));

  await disconnectDB();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});