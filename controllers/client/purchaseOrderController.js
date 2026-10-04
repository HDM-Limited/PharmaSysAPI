const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, paginated, noContent } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');

const PurchaseOrder = require('../../models/client/PurchaseOrder');
const Supplier = require('../../models/client/Supplier');
const Branch = require('../../models/client/Branch');
const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const { Drug, Batch, StockMovement } = require('../../models/client/Inventory');
const emailService = require('../../services/emailService');
const notificationService = require('../../services/notificationService');

/* ═════════════════════════════════════════════════════════════════
   Helpers
   ═════════════════════════════════════════════════════════════════ */

function generatePoNo() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PO-${y}${m}${d}-${rand}`;
}

/* ═════════════════════════════════════════════════════════════════
   LIST
   ═════════════════════════════════════════════════════════════════ */

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

/* ═════════════════════════════════════════════════════════════════
   GET
   ═════════════════════════════════════════════════════════════════ */

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

/* ═════════════════════════════════════════════════════════════════
   CREATE
   ═════════════════════════════════════════════════════════════════ */

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

/* ═════════════════════════════════════════════════════════════════
   RECEIVE
   ═════════════════════════════════════════════════════════════════ */

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

  const tenant = await Tenant.findById(req.tenantId).select('name').lean();
  const branch = await Branch.findById(branchId).select('name').lean();

  const recipients = await User.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    status: 'active',
    $or: [{ role: 'owner' }, { role: 'branch_manager', branchIds: branchId }],
  })
    .select('_id')
    .lean();

  for (const r of recipients) {
    notificationService
      .create({
        tenantId: req.tenantId,
        userId: r._id,
        branchId,
        type: 'inventory',
        title: `Stock received — ${po.poNo}`,
        body: `${items.length} line(s) received${branch?.name ? ` at ${branch.name}` : ''}`,
        link: `/app/purchase-orders/${po._id}`,
      })
      .catch(() => {});
  }

  return ok(res, po.toObject());
});

/* ═════════════════════════════════════════════════════════════════
   CANCEL
   ═════════════════════════════════════════════════════════════════ */

const cancel = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'poId');
  const { reason = null } = req.body;

  const po = await PurchaseOrder.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!po) throw ApiError.notFound('PO_NOT_FOUND', 'Purchase order not found');
  if (po.status === 'received') {
    throw ApiError.badRequest('CANNOT_CANCEL_RECEIVED', 'Cannot cancel a received PO');
  }

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

/* ═════════════════════════════════════════════════════════════════
   REMOVE (soft = cancel, hard = delete)
   ═════════════════════════════════════════════════════════════════ */

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'poId');
  const hard = String(req.query.hard) === 'true';

  if (hard && req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can permanently delete purchase orders');
  }

  const po = await PurchaseOrder.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!po) throw ApiError.notFound('PO_NOT_FOUND', 'Purchase order not found');

  if (hard) {
    // Guard: don't hard-delete a received PO — batches and movements reference it
    if (po.status === 'received') {
      throw ApiError.badRequest(
        'PO_RECEIVED',
        'Cannot permanently delete a received PO. Batches were created from it.'
      );
    }

    await PurchaseOrder.deleteOne({ _id: po._id });
    return ok(res, { deleted: true, permanent: true });
  }

  // Soft delete = mark cancelled
  if (po.status !== 'cancelled') {
    if (po.status === 'received') {
      throw ApiError.badRequest(
        'CANNOT_CANCEL_RECEIVED',
        'Cannot cancel a received PO. Its batches already exist.'
      );
    }
    po.status = 'cancelled';
    await po.save();
  }

  return noContent(res);
});

module.exports = { list, get, create, receive, cancel, remove };