require('./dnsSet');
require('dotenv/config');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  const tenants = await db.collection('tenants').find({}).toArray();
  let fixed = 0;

  for (const tenant of tenants) {
    const branches = await db
      .collection('branches')
      .find({ tenantId: tenant._id, isActive: true })
      .toArray();

    if (!branches.length) continue;

    const allBranchIds = branches.map((b) => b._id);

    const owners = await db
      .collection('users')
      .find({ tenantId: tenant._id, role: 'owner' })
      .toArray();

    for (const owner of owners) {
      // Union: whatever they already have + every active branch
      const current = (owner.branchIds || []).map(String);
      const needed = allBranchIds.map(String);
      const merged = Array.from(new Set([...current, ...needed]));

      // Only update if there's a difference
      if (merged.length !== current.length) {
        await db.collection('users').updateOne(
          { _id: owner._id },
          { $set: { branchIds: merged.map((id) => new mongoose.Types.ObjectId(id)) } }
        );
        fixed++;
        console.log(`  ✓ ${owner.email} → ${merged.length} branch(es)`);
      } else {
        console.log(`  · ${owner.email} already has all branches`);
      }
    }
  }

  console.log(`\nDone. Fixed ${fixed} owner(s).`);
  await disconnectDB();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});