require('./dnsSet');
require('dotenv/config');

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  const inv = db.collection('invoices');
  const tenants = db.collection('tenants');

  let upgraded = 0;
  let renewed = 0;

  // Upgrades: paid AND tenant already on the target plan → mark approved
  const paidUpgrades = await inv
    .find({ purpose: 'upgrade', status: 'paid', approvedAt: null })
    .toArray();

  for (const i of paidUpgrades) {
    const t = await tenants.findOne({ _id: i.tenantId });
    if (t && t.planCode === i.planCode) {
      await inv.updateOne(
        { _id: i._id },
        { $set: { approvedAt: i.paidAt || i.updatedAt, approvedBy: null } }
      );
      upgraded++;
      console.log('backfilled upgrade', i.invoiceNumber);
    }
  }

  // Renewals: paid AND tenant expiresAt is beyond the invoice's paidAt → applied
  const paidRenewals = await inv
    .find({ purpose: 'renewal', status: 'paid', approvedAt: null })
    .toArray();

  for (const i of paidRenewals) {
    const t = await tenants.findOne({ _id: i.tenantId });
    if (t && t.expiresAt && i.paidAt && new Date(t.expiresAt) > new Date(i.paidAt)) {
      await inv.updateOne(
        { _id: i._id },
        { $set: { approvedAt: i.paidAt, approvedBy: null } }
      );
      renewed++;
      console.log('backfilled renewal', i.invoiceNumber);
    }
  }

  console.log(`\nDone. upgrades=${upgraded} renewals=${renewed}`);

  await disconnectDB();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});