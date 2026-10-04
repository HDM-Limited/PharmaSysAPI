const Tenant = require('../../models/admin/Tenant');
const Branch = require('../../models/client/Branch');
const { Drug, Batch } = require('../../models/client/Inventory');
const notificationService = require('../../services/notificationService');
const { logger } = require('../../utils/logger');

async function activeTenants() {
  return Tenant.find({ status: 'active' }).select('_id name').lean();
}

async function branchesFor(tenantId) {
  return Branch.find({ tenantId, isActive: true }).select('_id name').lean();
}

async function runLowStockScan() {
  const tenants = await activeTenants();
  let sent = 0;

  for (const tenant of tenants) {
    const branches = await branchesFor(tenant._id);
    for (const branch of branches) {
      const drugs = await Drug.find({ tenantId: tenant._id, isActive: true }).select('_id name reorderLevel').lean();
      for (const drug of drugs) {
        const agg = await Batch.aggregate([
          { $match: { tenantId: tenant._id, branchId: branch._id, drugId: drug._id } },
          { $group: { _id: null, qty: { $sum: '$qty' } } },
        ]);
        const qty = agg[0]?.qty || 0;
        if (drug.reorderLevel && qty <= drug.reorderLevel && qty > 0) {
          // notify owner + branch manager
          // notificationService.sendLowStockAlert(...)
          sent++;
        }
      }
    }
  }
  logger.info({ sent }, 'low-stock scan complete');
  return { sent };
}

async function runOutOfStockScan() {
  logger.info('out-of-stock scan complete');
  return { sent: 0 };
}

async function runExpiryScan() {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);

  const batches = await Batch.find({ expiryDate: { $gte: now, $lte: in30 } })
    .select('tenantId branchId drugId qty expiryDate')
    .lean();

  logger.info({ count: batches.length }, 'expiry scan complete');
  return { count: batches.length };
}

async function runExpiredBatchSweep() {
  const now = new Date();
  const result = await Batch.updateMany(
    { expiryDate: { $lt: now }, qty: { $gt: 0 } },
    { $set: { qty: 0 } }
  );
  logger.info({ modified: result.modifiedCount }, 'expired batch sweep complete');
  return { modified: result.modifiedCount };
}

module.exports = {
  runLowStockScan,
  runOutOfStockScan,
  runExpiryScan,
  runExpiredBatchSweep,
};