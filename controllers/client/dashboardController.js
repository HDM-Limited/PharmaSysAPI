const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { toObjectId } = require('../../utils/objectId');
const Sale = require('../../models/client/Sale');
const { Drug, Batch } = require('../../models/client/Inventory');
const Patient = require('../../models/client/Patient');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');
const aiService = require('../../services/aiService');

/* ═════════════════════════════════════════════════════════════════
   SUMMARY
   ═════════════════════════════════════════════════════════════════ */

const summary = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const salesFilter = {
    tenantId: tenantObjId,
    createdAt: { $gte: start },
    status: { $ne: 'voided' },
    ...branchFilter,
  };

  const [salesAgg, patientsToday, lowStockCount, expiringCount, recentSales] = await Promise.all([
    Sale.aggregate([
      { $match: salesFilter },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]),
    Patient.countDocuments({
      __allowGlobal: true,
      tenantId: req.tenantId,
      createdAt: { $gte: start },
    }),
    (async () => {
      const drugs = await Drug.find({
        __allowGlobal: true,
        tenantId: req.tenantId,
        isActive: true,
        reorderLevel: { $gt: 0 },
      }).lean();
      if (!drugs.length) return 0;
      const agg = await Batch.aggregate([
        { $match: { tenantId: tenantObjId, ...branchFilter } },
        { $group: { _id: '$drugId', qty: { $sum: '$qty' } } },
      ]);
      const qtyByDrug = Object.fromEntries(agg.map((r) => [String(r._id), r.qty]));
      return drugs.filter((d) => (qtyByDrug[String(d._id)] || 0) <= d.reorderLevel).length;
    })(),
    Batch.countDocuments({
      __allowGlobal: true,
      tenantId: req.tenantId,
      expiryDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 86_400_000) },
      qty: { $gt: 0 },
      ...branchFilter,
    }),
    Sale.find({ __allowGlobal: true, ...salesFilter }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  const tenant = await Tenant.findById(req.tenantId).select('planCode').lean();
  const plan = await Plan.findOne({ code: tenant?.planCode }).lean();

  const total = salesAgg[0]?.total || 0;
  const count = salesAgg[0]?.count || 0;

  return ok(res, {
    salesToday: total,
    salesTodayCount: count,
    currency: plan?.price?.currency || 'KES',
    lowStockCount,
    expiringSoonCount: expiringCount,
    newPatientsToday: patientsToday,
    kpis: [
      { label: 'Sales today', value: `${plan?.price?.currency || 'KES'} ${Math.round(total)}` },
      { label: 'Transactions', value: String(count) },
      { label: 'Low stock', value: String(lowStockCount), trend: lowStockCount > 0 ? 'down' : 'flat' },
      { label: 'Expiring soon', value: String(expiringCount), trend: expiringCount > 0 ? 'down' : 'flat' },
    ],
    recentSales,
  });
});

/* ═════════════════════════════════════════════════════════════════
   INSIGHTS
   ═════════════════════════════════════════════════════════════════ */

const insights = asyncHandler(async (req, res) => {
  const insight = await aiService.generateWeeklyInsights({
    tenantId: req.tenantId,
    branchId: req.branchId,
    force: req.query.refresh === 'true',
  });
  return ok(res, insight);
});

module.exports = { summary, insights };