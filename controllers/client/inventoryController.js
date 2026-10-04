const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, noContent, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');

const { Drug, Batch, StockMovement } = require('../../models/client/Inventory');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');

/* ─────────────── DRUGS ─────────────── */

const listDrugs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId, isActive: true };
  if (req.query.search) {
    filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { generic: { $regex: req.query.search, $options: 'i' } },
      { barcode: req.query.search },
    ];
  }
  if (req.query.category) filter.category = req.query.category;

  const [items, total] = await Promise.all([
    Drug.find({ __allowGlobal: true, ...filter }).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    Drug.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

const getDrug = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'drugId');
  const drug = await Drug.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  }).lean();
  if (!drug) throw ApiError.notFound('DRUG_NOT_FOUND', 'Drug not found');

  const batchFilter = { __allowGlobal: true, tenantId: req.tenantId, drugId: drug._id };
  if (req.branchId) batchFilter.branchId = req.branchId;

  const batches = await Batch.find(batchFilter).sort({ expiryDate: 1 }).lean();

  return ok(res, { drug, batches });
});

const createDrug = asyncHandler(async (req, res) => {
  const { name, form } = req.body;
  if (!name || !form) throw ApiError.badRequest('MISSING_FIELDS', 'name and form required');

  const tenant = await Tenant.findById(req.tenantId).select('planCode').lean();
  const plan = await Plan.findOne({ code: tenant.planCode }).lean();
  const max = plan?.limits?.maxProducts ?? 100;

  const count = await Drug.countDocuments({ __allowGlobal: true, tenantId: req.tenantId, isActive: true });
  if (count >= max) {
    throw ApiError.badRequest('LIMIT_PRODUCTS', `Plan allows ${max} products`);
  }

  const allowed = [
    'name', 'generic', 'brand', 'barcode', 'category', 'form', 'strength', 'unit',
    'taxRate', 'reorderLevel', 'prescriptionRequired', 'controlled',
    'imagePublicId', 'imageUrl',
  ];
  const data = { tenantId: req.tenantId, isActive: true };
  for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];

  const drug = await Drug.create(data);
  return created(res, drug.toObject());
});

const updateDrug = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'drugId');
  const allowed = [
    'name', 'generic', 'brand', 'barcode', 'category', 'form', 'strength', 'unit',
    'taxRate', 'reorderLevel', 'prescriptionRequired', 'controlled',
    'imagePublicId', 'imageUrl', 'isActive',
  ];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const drug = await Drug.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!drug) throw ApiError.notFound('DRUG_NOT_FOUND', 'Drug not found');
  return ok(res, drug);
});

const removeDrug = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'drugId');
  const result = await Drug.updateOne(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false } }
  );
  if (result.matchedCount === 0) throw ApiError.notFound('DRUG_NOT_FOUND', 'Drug not found');
  return noContent(res);
});

/* ─────────────── BATCHES ─────────────── */

const addBatch = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'drugId');
  const { qty, costPrice = 0, sellingPrice = 0, expiryDate, lotNo = null, supplierId = null } = req.body;

  if (!Number.isFinite(qty) || qty <= 0) throw ApiError.badRequest('INVALID_QTY', 'qty must be > 0');
  if (!expiryDate) throw ApiError.badRequest('MISSING_EXPIRY', 'expiryDate required');
  if (new Date(expiryDate) <= new Date()) throw ApiError.badRequest('EXPIRED_DATE', 'expiryDate must be in the future');

  const drug = await Drug.findOne({ __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId }).lean();
  if (!drug) throw ApiError.notFound('DRUG_NOT_FOUND', 'Drug not found');

  const branchId = req.branchId || req.branchIds[0];
  if (!branchId) throw ApiError.badRequest('BRANCH_REQUIRED', 'A branch is required');

  const batch = await Batch.create({
    tenantId: req.tenantId,
    branchId,
    drugId: drug._id,
    lotNo,
    qty,
    costPrice,
    sellingPrice,
    expiryDate: new Date(expiryDate),
    supplierId,
    receivedAt: new Date(),
  });

  await StockMovement.create({
    tenantId: req.tenantId,
    branchId,
    drugId: drug._id,
    batchId: batch._id,
    type: 'in',
    qty,
    ref: 'batch_create',
    userId: req.user._id,
    note: null,
  });

  return created(res, batch.toObject());
});

const listBatches = asyncHandler(async (req, res) => {
  const { drugId } = req.query;
  if (!drugId) throw ApiError.badRequest('MISSING_DRUG', 'drugId query param required');
  assertObjectId(drugId, 'drugId');

  const filter = { __allowGlobal: true, tenantId: req.tenantId, drugId };
  if (req.branchId) filter.branchId = req.branchId;

  const items = await Batch.find(filter).sort({ expiryDate: 1 }).lean();
  return ok(res, items);
});

const updateBatch = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'batchId');
  const allowed = ['qty', 'costPrice', 'sellingPrice', 'expiryDate', 'lotNo'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const batch = await Batch.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!batch) throw ApiError.notFound('BATCH_NOT_FOUND', 'Batch not found');
  return ok(res, batch);
});

const removeBatch = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'batchId');
  const batch = await Batch.findOne({ __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId });
  if (!batch) throw ApiError.notFound('BATCH_NOT_FOUND', 'Batch not found');
  if (batch.qty > 0) throw ApiError.badRequest('BATCH_IN_USE', 'Cannot delete a batch with stock remaining');
  await batch.deleteOne();
  return noContent(res);
});

/* ─────────────── STOCK ─────────────── */

const adjust = asyncHandler(async (req, res) => {
  const { drugId, batchId = null, type, qty, note = null } = req.body;
  if (!drugId || !type || !Number.isFinite(qty)) {
    throw ApiError.badRequest('MISSING_FIELDS', 'drugId, type, qty required');
  }
  if (!['in', 'out', 'adjust', 'expired', 'returned'].includes(type)) {
    throw ApiError.badRequest('INVALID_TYPE', 'Invalid movement type');
  }

  const branchId = req.branchId || req.branchIds[0];
  if (!branchId) throw ApiError.badRequest('BRANCH_REQUIRED', 'A branch is required');

  const movement = await StockMovement.create({
    tenantId: req.tenantId,
    branchId,
    drugId,
    batchId,
    type,
    qty,
    userId: req.user._id,
    note,
  });

  return created(res, movement.toObject());
});

const listMovements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId };
  if (req.branchId) filter.branchId = req.branchId;
  if (req.query.drugId) filter.drugId = req.query.drugId;

  const [items, total] = await Promise.all([
    StockMovement.find({ __allowGlobal: true, ...filter })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StockMovement.countDocuments({ __allowGlobal: true, ...filter }),
  ]);
  return paginated(res, items, page, limit, total);
});

const lowStock = asyncHandler(async (req, res) => {
  const branchFilter = req.branchId ? { branchId: req.branchId } : {};
  const drugs = await Drug.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    isActive: true,
    reorderLevel: { $gt: 0 },
  }).lean();
  if (!drugs.length) return ok(res, []);

  const agg = await Batch.aggregate([
    { $match: { tenantId: req.tenantId, ...branchFilter } },
    { $group: { _id: '$drugId', qty: { $sum: '$qty' } } },
  ]);
  const qtyByDrug = Object.fromEntries(agg.map((r) => [String(r._id), r.qty]));

  const out = drugs
    .map((d) => ({ ...d, currentQty: qtyByDrug[String(d._id)] || 0 }))
    .filter((d) => d.currentQty <= d.reorderLevel)
    .sort((a, b) => a.currentQty - b.currentQty);

  return ok(res, out);
});

const expiring = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const now = new Date();
  const until = new Date(Date.now() + days * 86_400_000);

  const filter = {
    __allowGlobal: true,
    tenantId: req.tenantId,
    expiryDate: { $gte: now, $lte: until },
    qty: { $gt: 0 },
  };
  if (req.branchId) filter.branchId = req.branchId;

  const items = await Batch.find(filter)
    .populate('drugId', 'name generic form')
    .sort({ expiryDate: 1 })
    .lean();

  return ok(res, items);
});

module.exports = {
  listDrugs,
  getDrug,
  createDrug,
  updateDrug,
  removeDrug,
  addBatch,
  listBatches,
  updateBatch,
  removeBatch,
  adjust,
  listMovements,
  lowStock,
  expiring,
};