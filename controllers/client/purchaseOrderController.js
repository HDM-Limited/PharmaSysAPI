const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');

const PurchaseOrder = require('../../models/client/PurchaseOrder');
const Supplier = require('../../models/client/Supplier');
const { Drug, Batch, StockMovement } = require('../../models/client/Inventory');
const emailService = require('../../services/emailService');

function generatePoNo() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PO-${y}${m}${d}-${rand}`;
}

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId };
  if (req.branchId) filter.branchId = req.branchId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.supplierId) filter.supplierId = req.query.supplierId;

  const [items, total] = await Promise.all([
    PurchaseOrder.find({ __allowGlobal: true, ...filter })
      .populate('supplierId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PurchaseOrder.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'poId');
  const po = await PurchaseOrder.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .populate('supplierId', 'name email phone contactPerson')
    .lean();
  if (!po) throw ApiError.notFound('PO_NOT_FOUND', 'Purchase order not found');
  return ok(res, po);
});

const create = asyncHandler(async (req, res) => {
  const { supplierId, items, notes = null } = req.body;
  if (!supplierId || !Array.isArray(items) || !items.length) {
    throw ApiError.badRequest('MISSING_FIELDS', 'supplierId and items required');
  }

  const supplier = await Supplier.findOne({
    __allowGlobal: true,
    _id: supplierId,
    tenantId: req.tenantId,
  }).lean();
  if (!supplier) throw ApiError.notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');

  const branchId = req.branchId || req.branchIds[0];
  if (!branchId) throw ApiError.badRequest('BRANCH_REQUIRED', 'A branch is required');

  const resolvedItems = items.map((i) => ({
    drugId: i.drugId,
    qty: Number(i.qty),
    costPrice: Number(i.costPrice) || 0,
    total: Number(i.qty) * (Number(i.costPrice) || 0),
  }));

  const subtotal = resolvedItems.reduce((s, i) => s + i.total, 0);

  const po = await PurchaseOrder.create({
    tenantId: req.tenantId,
    branchId,
    supplierId,
    poNo: generatePoNo(),
    status: 'draft',
    items: resolvedItems,
    subtotal,
    tax: 0,
    total: subtotal,
    notes,
    createdBy: req.user._id,
  });

  if (supplier.email) {
    emailService
      .sendPurchaseOrder({
        tenantId: req.tenantId,
        to: supplier.email,
        businessName: 'Your Pharmacy',
        supplierName: supplier.name,
        poNumber: po.poNo,
        items: resolvedItems,
        subtotal: po.subtotal,
        tax: po.tax,
        shipping: 0,
        total: po.total,
        currency: 'KES',
        notes,
        pdfUrl: null,
        businessContact: null,
      })
      .catch(() => {});
  }

  return created(res, po.toObject());
});

const receive = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'poId');
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    throw ApiError.badRequest('MISSING_ITEMS', 'items required');
  }

  const po = await PurchaseOrder.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!po) throw ApiError.notFound('PO_NOT_FOUND', 'Purchase order not found');
  if (po.status === 'received') throw ApiError.badRequest('ALREADY_RECEIVED', 'PO already received');

  const branchId = po.branchId;

  for (const line of items) {
    const { drugId, qty, costPrice, sellingPrice, lotNo = null, expiryDate } = line;
    if (!drugId || !qty || !expiryDate) {
      throw ApiError.badRequest('MISSING_FIELDS', 'drugId, qty, expiryDate required per line');
    }

    const drug = await Drug.findOne({
      __allowGlobal: true,
      _id: drugId,
      tenantId: req.tenantId,
    }).lean();
    if (!drug) throw ApiError.notFound('DRUG_NOT_FOUND', `Drug ${drugId} not found`);

    const batch = await Batch.create({
      tenantId: req.tenantId,
      branchId,
      drugId,
      lotNo,
      qty: Number(qty),
      costPrice: Number(costPrice) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      expiryDate: new Date(expiryDate),
      supplierId: po.supplierId,
      receivedAt: new Date(),
    });

    await StockMovement.create({
      tenantId: req.tenantId,
      branchId,
      drugId,
      batchId: batch._id,
      type: 'in',
      qty: Number(qty),
      ref: po.poNo,
      userId: req.user._id,
      note: 'PO receive',
    });
  }

  po.status = 'received';
  po.receivedAt = new Date();
  await po.save();

  return ok(res, po.toObject());
});

const cancel = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'poId');
  const { reason = null } = req.body;

  const po = await PurchaseOrder.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!po) throw ApiError.notFound('PO_NOT_FOUND', 'Purchase order not found');
  if (po.status === 'received') throw ApiError.badRequest('CANNOT_CANCEL_RECEIVED', 'Cannot cancel a received PO');

  po.status = 'cancelled';
  po.notes = `${po.notes || ''}\nCancelled: ${reason || 'no reason'}`.trim();
  await po.save();

  const supplier = await Supplier.findOne({ __allowGlobal: true, _id: po.supplierId }).lean();
  if (supplier?.email) {
    emailService
      .sendPurchaseOrderCancelled({
        tenantId: req.tenantId,
        to: supplier.email,
        businessName: 'Your Pharmacy',
        supplierName: supplier.name,
        poNumber: po.poNo,
        reason,
      })
      .catch(() => {});
  }

  return ok(res, po.toObject());
});

module.exports = { list, get, create, receive, cancel };