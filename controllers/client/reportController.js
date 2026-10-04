const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const Sale = require('../../models/client/Sale');
const { Batch } = require('../../models/client/Inventory');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');

function rangeFromQuery(query) {
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
  const to = query.to ? new Date(query.to) : new Date();
  return { from, to };
}

const salesDaily = asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const filter = { tenantId: req.tenantId, createdAt: { $gte: start, $lte: end }, status: { $ne: 'voided' } };
  if (req.branchId) filter.branchId = req.branchId;

  const agg = await Sale.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
  ]);

  const total = agg[0]?.total || 0;
  const count = agg[0]?.count || 0;

  const tenant = await Tenant.findById(req.tenantId).select('planCode settings').lean();
  const plan = await Plan.findOne({ code: tenant?.planCode }).lean();

  return ok(res, {
    total,
    count,
    averageBasket: count ? total / count : 0,
    currency: plan?.price?.currency || 'KES',
  });
});

const salesRange = asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query);
  const groupBy = req.query.groupBy || 'day';
  const format = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%G-W%V' : '%Y-%m-%d';

  const filter = { tenantId: req.tenantId, createdAt: { $gte: from, $lte: to }, status: { $ne: 'voided' } };
  if (req.branchId) filter.branchId = req.branchId;

  const rows = await Sale.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $dateToString: { format, date: '$createdAt' } },
        total: { $sum: '$grandTotal' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return ok(res, rows.map((r) => ({ date: r._id, total: r.total, count: r.count })));
});

const topDrugs = asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query);
  const limit = Number(req.query.limit) || 10;

  const filter = { tenantId: req.tenantId, createdAt: { $gte: from, $lte: to }, status: { $ne: 'voided' } };
  if (req.branchId) filter.branchId = req.branchId;

  const rows = await Sale.aggregate([
    { $match: filter },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.name',
        qty: { $sum: '$items.qty' },
        revenue: { $sum: '$items.total' },
      },
    },
    { $sort: { qty: -1 } },
    { $limit: limit },
  ]);

  return ok(res, rows.map((r) => ({ name: r._id, qty: r.qty, revenue: r.revenue })));
});

const expiryLoss = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const until = new Date(Date.now() + days * 86_400_000);

  const filter = {
    __allowGlobal: true,
    tenantId: req.tenantId,
    expiryDate: { $lte: until },
    qty: { $gt: 0 },
  };
  if (req.branchId) filter.branchId = req.branchId;

  const batches = await Batch.find(filter)
    .populate('drugId', 'name')
    .sort({ expiryDate: 1 })
    .lean();

  const items = batches.map((b) => ({
    drugName: b.drugId?.name || 'Unknown',
    lotNo: b.lotNo,
    qty: b.qty,
    costPrice: b.costPrice,
    expiryDate: b.expiryDate,
    loss: b.qty * b.costPrice,
  }));

  const totalLoss = items.reduce((s, i) => s + i.loss, 0);
  return ok(res, { totalLoss, items });
});

const tax = asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query);

  const filter = { tenantId: req.tenantId, createdAt: { $gte: from, $lte: to }, status: { $ne: 'voided' } };
  if (req.branchId) filter.branchId = req.branchId;

  const agg = await Sale.aggregate([
    { $match: filter },
    { $group: { _id: null, tax: { $sum: '$tax' }, subtotal: { $sum: '$subtotal' } } },
  ]);

  const taxCollected = agg[0]?.tax || 0;
  const taxableAmount = agg[0]?.subtotal || 0;

  const tenant = await Tenant.findById(req.tenantId).select('planCode').lean();
  const plan = await Plan.findOne({ code: tenant?.planCode }).lean();

  return ok(res, {
    taxCollected,
    taxableAmount,
    currency: plan?.price?.currency || 'KES',
    periodStart: from.toISOString(),
    periodEnd: to.toISOString(),
  });
});

module.exports = { salesDaily, salesRange, topDrugs, expiryLoss, tax };