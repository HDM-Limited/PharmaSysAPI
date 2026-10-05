const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { toObjectId } = require('../../utils/objectId');
const Sale = require('../../models/client/Sale');
const { Drug, Batch } = require('../../models/client/Inventory');
const Customer = require('../../models/client/Customer');
const Patient = require('../../models/client/Patient');
const User = require('../../models/client/User');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');

/* ═════════════════════════════════════════════════════════════════
   Helpers
   ═════════════════════════════════════════════════════════════════ */

function rangeFromQuery(query) {
  const from = query.from
    ? new Date(query.from)
    : new Date(Date.now() - 30 * 86_400_000);
  const to = query.to ? new Date(query.to) : new Date();
  return { from, to };
}

/* ═════════════════════════════════════════════════════════════════
   SALES — DAILY
   ═════════════════════════════════════════════════════════════════ */

const salesDaily = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const date = req.query.date ? new Date(req.query.date) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const filter = {
    tenantId: tenantObjId,
    createdAt: { $gte: start, $lte: end },
    status: { $ne: 'voided' },
    ...branchFilter,
  };

  const agg = await Sale.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: '$grandTotal' },
        count: { $sum: 1 },
      },
    },
  ]);

  const total = agg[0]?.total || 0;
  const count = agg[0]?.count || 0;

  const tenant = await Tenant.findById(req.tenantId)
    .select('planCode settings')
    .lean();
  const plan = await Plan.findOne({ code: tenant?.planCode }).lean();

  return ok(res, {
    total,
    count,
    averageBasket: count ? total / count : 0,
    currency: plan?.price?.currency || 'KES',
  });
});

/* ═════════════════════════════════════════════════════════════════
   SALES — RANGE
   ═════════════════════════════════════════════════════════════════ */

const salesRange = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const { from, to } = rangeFromQuery(req.query);
  const groupBy = req.query.groupBy || 'day';
  const format =
    groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%G-W%V' : '%Y-%m-%d';

  const filter = {
    tenantId: tenantObjId,
    createdAt: { $gte: from, $lte: to },
    status: { $ne: 'voided' },
    ...branchFilter,
  };

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

  return ok(
    res,
    rows.map((r) => ({ date: r._id, total: r.total, count: r.count }))
  );
});

/* ═════════════════════════════════════════════════════════════════
   SALES — TOP DRUGS
   ═════════════════════════════════════════════════════════════════ */

const topDrugs = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const { from, to } = rangeFromQuery(req.query);
  const limit = Number(req.query.limit) || 10;

  const filter = {
    tenantId: tenantObjId,
    createdAt: { $gte: from, $lte: to },
    status: { $ne: 'voided' },
    ...branchFilter,
  };

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

  return ok(
    res,
    rows.map((r) => ({ name: r._id, qty: r.qty, revenue: r.revenue }))
  );
});

/* ═════════════════════════════════════════════════════════════════
   EXPIRY LOSS
   ═════════════════════════════════════════════════════════════════ */

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

/* ═════════════════════════════════════════════════════════════════
   TAX
   ═════════════════════════════════════════════════════════════════ */

const tax = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const { from, to } = rangeFromQuery(req.query);

  const filter = {
    tenantId: tenantObjId,
    createdAt: { $gte: from, $lte: to },
    status: { $ne: 'voided' },
    ...branchFilter,
  };

  const agg = await Sale.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        tax: { $sum: '$tax' },
        subtotal: { $sum: '$subtotal' },
      },
    },
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

/* ═════════════════════════════════════════════════════════════════
   INVENTORY — STOCK ON HAND
   ═════════════════════════════════════════════════════════════════ */

const inventoryStock = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const drugs = await Drug.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    isActive: true,
  })
    .select('name generic form strength unit reorderLevel category')
    .sort({ name: 1 })
    .lean();

  if (!drugs.length) {
    return ok(res, {
      items: [],
      summary: {
        drugs: 0,
        totalQty: 0,
        totalValue: 0,
        totalValueSell: 0,
        outOfStock: 0,
        lowStock: 0,
      },
    });
  }

  const drugIds = drugs.map((d) => d._id);
  const agg = await Batch.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        drugId: { $in: drugIds },
        ...branchFilter,
      },
    },
    {
      $group: {
        _id: '$drugId',
        qty: { $sum: '$qty' },
        valueCost: { $sum: { $multiply: ['$qty', '$costPrice'] } },
        valueSell: { $sum: { $multiply: ['$qty', '$sellingPrice'] } },
        batches: { $sum: 1 },
      },
    },
  ]);

  const byDrug = Object.fromEntries(agg.map((r) => [String(r._id), r]));

  const items = drugs.map((d) => {
    const s = byDrug[String(d._id)] || {};
    return {
      _id: d._id,
      name: d.name,
      generic: d.generic,
      form: d.form,
      strength: d.strength,
      unit: d.unit,
      category: d.category,
      reorderLevel: d.reorderLevel,
      qty: s.qty || 0,
      valueCost: s.valueCost || 0,
      valueSell: s.valueSell || 0,
      batches: s.batches || 0,
    };
  });

  const summary = {
    drugs: items.length,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    totalValue: items.reduce((s, i) => s + i.valueCost, 0),
    totalValueSell: items.reduce((s, i) => s + i.valueSell, 0),
    outOfStock: items.filter((i) => i.qty === 0).length,
    lowStock: items.filter((i) => i.qty > 0 && i.qty <= i.reorderLevel).length,
  };

  return ok(res, { items, summary });
});

/* ═════════════════════════════════════════════════════════════════
   CUSTOMERS — TOP SPENDERS
   ═════════════════════════════════════════════════════════════════ */

const customersTop = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const items = await Customer.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    isActive: true,
  })
    .sort({ totalSpent: -1, loyaltyPoints: -1 })
    .limit(limit)
    .select('name phone email loyaltyPoints totalSpent lastPurchaseAt createdAt')
    .lean();

  const summary = {
    count: items.length,
    totalSpent: items.reduce((s, c) => s + (c.totalSpent || 0), 0),
    totalLoyaltyPoints: items.reduce((s, c) => s + (c.loyaltyPoints || 0), 0),
    avgSpent: items.length
      ? items.reduce((s, c) => s + (c.totalSpent || 0), 0) / items.length
      : 0,
  };

  return ok(res, { items, summary });
});

/* ═════════════════════════════════════════════════════════════════
   PATIENTS — DEMOGRAPHICS
   ═════════════════════════════════════════════════════════════════ */

const patientsDemographics = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const patients = await Patient.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    isActive: true,
  })
    .select('name phone gender dob allergies chronicConditions createdAt')
    .sort({ name: 1 })
    .lean();

  const now = new Date();
  const total = patients.length;

  const byGender = { male: 0, female: 0, other: 0, unknown: 0 };
  const ageBands = {
    'Under 5': 0,
    '5–17': 0,
    '18–29': 0,
    '30–44': 0,
    '45–59': 0,
    '60+': 0,
    Unknown: 0,
  };

  let withAllergies = 0;
  let withChronic = 0;

  for (const p of patients) {
    const g = p.gender || 'unknown';
    if (g in byGender) byGender[g]++;
    else byGender.unknown++;

    if (p.allergies?.length) withAllergies++;
    if (p.chronicConditions?.length) withChronic++;

    if (!p.dob) {
      ageBands.Unknown++;
      continue;
    }
    const age =
      (now.getTime() - new Date(p.dob).getTime()) / (365.25 * 86_400_000);
    if (age < 5) ageBands['Under 5']++;
    else if (age < 18) ageBands['5–17']++;
    else if (age < 30) ageBands['18–29']++;
    else if (age < 45) ageBands['30–44']++;
    else if (age < 60) ageBands['45–59']++;
    else ageBands['60+']++;
  }

  // Recent visits — sales with a patient attached in last 30d
  const since = new Date(Date.now() - 30 * 86_400_000);
  const visitAgg = await Sale.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        createdAt: { $gte: since },
        patientId: { $ne: null },
        ...branchFilter,
      },
    },
    {
      $group: {
        _id: '$patientId',
        visits: { $sum: 1 },
        total: { $sum: '$grandTotal' },
      },
    },
    { $sort: { visits: -1 } },
    { $limit: 30 },
  ]);

  const topPatientIds = visitAgg.map((r) => r._id);
  const topPatients = await Patient.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    _id: { $in: topPatientIds },
  })
    .select('name phone')
    .lean();

  const patientMap = Object.fromEntries(
    topPatients.map((p) => [String(p._id), p])
  );
  const topVisits = visitAgg.map((r) => ({
    patient: patientMap[String(r._id)] || null,
    visits: r.visits,
    total: r.total,
  }));

  return ok(res, {
    total,
    byGender,
    ageBands,
    withAllergies,
    withChronic,
    topVisits,
    patients,
  });
});

/* ═════════════════════════════════════════════════════════════════
   STAFF — SUMMARY
   ═════════════════════════════════════════════════════════════════ */

const staffSummary = asyncHandler(async (req, res) => {
  const tenantObjId = toObjectId(req.tenantId);
  const branchObjId = req.branchId ? toObjectId(req.branchId) : null;
  const branchFilter = branchObjId ? { branchId: branchObjId } : {};

  const users = await User.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
  })
    .select('fullName email phone role status branchIds lastLoginAt createdAt')
    .sort({ role: 1, fullName: 1 })
    .lean();

  const byRole = { owner: 0, branch_manager: 0, cashier: 0 };
  const byStatus = { active: 0, pending: 0, suspended: 0, rejected: 0 };
  for (const u of users) {
    if (u.role in byRole) byRole[u.role]++;
    if (u.status in byStatus) byStatus[u.status]++;
  }

  // Sales count per cashier over last 30 days
  const since = new Date(Date.now() - 30 * 86_400_000);
  const salesAgg = await Sale.aggregate([
    {
      $match: {
        tenantId: tenantObjId,
        createdAt: { $gte: since },
        ...branchFilter,
      },
    },
    {
      $group: {
        _id: '$cashierId',
        salesCount: { $sum: 1 },
        salesTotal: { $sum: '$grandTotal' },
      },
    },
  ]);
  const salesByUser = Object.fromEntries(
    salesAgg.map((r) => [String(r._id), r])
  );

  const items = users.map((u) => {
    const s = salesByUser[String(u._id)] || {};
    return {
      ...u,
      salesCount30d: s.salesCount || 0,
      salesTotal30d: s.salesTotal || 0,
    };
  });

  const summary = {
    total: users.length,
    byRole,
    byStatus,
    activeLast7d: users.filter(
      (u) =>
        u.lastLoginAt &&
        new Date(u.lastLoginAt) > new Date(Date.now() - 7 * 86_400_000)
    ).length,
  };

  return ok(res, { items, summary });
});

/* ═════════════════════════════════════════════════════════════════
   EXPORTS — fail loudly if any handler is missing
   ═════════════════════════════════════════════════════════════════ */

const exported = {
  salesDaily,
  salesRange,
  topDrugs,
  expiryLoss,
  tax,
  inventoryStock,
  customersTop,
  patientsDemographics,
  staffSummary,
};

for (const [name, fn] of Object.entries(exported)) {
  if (typeof fn !== 'function') {
    throw new Error(`reportController: export "${name}" is not a function`);
  }
}

module.exports = exported;