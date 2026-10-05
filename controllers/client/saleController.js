const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { generateInvoiceNumber } = require('../../utils/invoiceNumber');

const Sale = require('../../models/client/Sale');
const { Drug, Batch, StockMovement } = require('../../models/client/Inventory');
const Customer = require('../../models/client/Customer');
const Patient = require('../../models/client/Patient');
const Prescription = require('../../models/client/Prescription');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');
const notificationService = require('../../services/notificationService');

/* ═════════════════════════════════════════════════════════════════
   Helpers
   ═════════════════════════════════════════════════════════════════ */

async function pickBatchFEFO(tenantId, branchId, drugId, requiredQty) {
  const batches = await Batch.find({
    __allowGlobal: true,
    tenantId,
    branchId,
    drugId,
    qty: { $gt: 0 },
    expiryDate: { $gt: new Date() },
  })
    .sort({ expiryDate: 1 })
    .lean();

  const picked = [];
  let remaining = requiredQty;

  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.qty, remaining);
    picked.push({ batch: b, qty: take });
    remaining -= take;
  }

  if (remaining > 0) {
    throw ApiError.badRequest('INSUFFICIENT_STOCK', `Not enough stock for drug ${drugId}`);
  }
  return picked;
}

/* ═════════════════════════════════════════════════════════════════
   CREATE
   ═════════════════════════════════════════════════════════════════ */

const create = asyncHandler(async (req, res) => {
  const {
    items,
    customerId = null,
    patientId = null,
    prescriptionId = null,
    paymentMethod = 'cash',
    discount = 0,
    note = null,
  } = req.body;

  if (!Array.isArray(items) || !items.length) {
    throw ApiError.badRequest('EMPTY_SALE', 'At least one item is required');
  }

  const branchId = req.branchId || req.branchIds[0];
  if (!branchId) throw ApiError.badRequest('BRANCH_REQUIRED', 'A branch is required');

  const tenant = await Tenant.findById(req.tenantId).select('name planCode').lean();
  const plan = await Plan.findOne({ code: tenant.planCode }).lean();
  const monthlyLimit = plan?.limits?.maxTransactionsPerMonth ?? 0;

  if (monthlyLimit > 0) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const count = await Sale.countDocuments({
      __allowGlobal: true,
      tenantId: req.tenantId,
      createdAt: { $gte: startOfMonth },
      status: { $ne: 'voided' },
    });
    if (count >= monthlyLimit) {
      throw ApiError.badRequest(
        'LIMIT_TRANSACTIONS',
        `Plan allows ${monthlyLimit} transactions per month`
      );
    }
  }

  const resolved = [];
  for (const line of items) {
    assertObjectId(line.drugId, 'drugId');

    const drug = await Drug.findOne({
      __allowGlobal: true,
      _id: line.drugId,
      tenantId: req.tenantId,
      isActive: true,
    }).lean();
    if (!drug) throw ApiError.notFound('DRUG_NOT_FOUND', `Drug ${line.drugId} not found`);

    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw ApiError.badRequest('INVALID_QTY', `Invalid qty for ${drug.name}`);
    }

    const unitPrice = line.unitPrice != null ? Number(line.unitPrice) : 0;
    const lineDiscount = Number(line.discount) || 0;
    const lineTotal = qty * unitPrice - lineDiscount;

    const picks = await pickBatchFEFO(req.tenantId, branchId, drug._id, qty);

    resolved.push({
      drug,
      qty,
      unitPrice,
      discount: lineDiscount,
      lineTotal,
      picks,
      taxRate: drug.taxRate || 0,
    });
  }

  const saleItems = [];
  for (const r of resolved) {
    for (const p of r.picks) {
      saleItems.push({
        drugId: r.drug._id,
        batchId: p.batch._id,
        name: r.drug.name,
        qty: p.qty,
        unitPrice: r.unitPrice,
        discount: 0,
        total: p.qty * r.unitPrice,
      });
    }
  }

  const subtotal = saleItems.reduce((s, i) => s + i.total, 0);
  const tax = resolved.reduce((s, r) => s + (r.lineTotal * r.taxRate) / 100, 0);
  const discountAmount = Number(discount) || 0;
  const grandTotal = subtotal + tax - discountAmount;

  const invoiceNo = generateInvoiceNumber('SALE');

  const sale = await Sale.create({
    tenantId: req.tenantId,
    branchId,
    invoiceNo,
    cashierId: req.user._id,
    items: saleItems,
    subtotal,
    tax,
    discount: discountAmount,
    grandTotal,
    paymentMethod,
    customerId,
    patientId,
    prescriptionId,
    status: 'completed',
    returns: [],
  });

  /* Decrement batches + log movements */
  for (const r of resolved) {
    for (const p of r.picks) {
      await Batch.updateOne(
        { __allowGlobal: true, _id: p.batch._id },
        { $inc: { qty: -p.qty } }
      );
      await StockMovement.create({
        tenantId: req.tenantId,
        branchId,
        drugId: r.drug._id,
        batchId: p.batch._id,
        type: 'out',
        qty: p.qty,
        ref: invoiceNo,
        userId: req.user._id,
        note: note || null,
      });
    }
  }

  if (customerId) {
    await Customer.updateOne(
      { __allowGlobal: true, _id: customerId, tenantId: req.tenantId },
      {
        $inc: { totalSpent: grandTotal },
        $set: { lastPurchaseAt: new Date() },
      }
    );
  }

  if (prescriptionId) {
    await Prescription.updateOne(
      { __allowGlobal: true, _id: prescriptionId, tenantId: req.tenantId },
      {
        $set: {
          status: 'dispensed',
          dispensedBy: req.user._id,
          dispensedAt: new Date(),
        },
      }
    );
  }

  notificationService
    .notifyBranchManagers({
      tenantId: req.tenantId,
      branchId,
      type: 'sale',
      title: 'New sale',
      body: `${invoiceNo} — ${grandTotal}`,
      link: `/app/sales/${sale._id}`,
      meta: { saleId: String(sale._id), amount: grandTotal },
    })
    .catch(() => {});

  /* Return with all references populated so the client can print a full receipt */
  const populated = await Sale.findById(sale._id)
    .populate('customerId', 'name phone email')
    .populate('patientId', 'name phone')
    .populate('cashierId', 'fullName email')
    .populate('branchId', 'name code address phone')
    .lean();

  return created(res, populated || sale.toObject());
});

/* ═════════════════════════════════════════════════════════════════
   LIST
   ═════════════════════════════════════════════════════════════════ */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId };
  if (req.branchId) filter.branchId = req.branchId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.method) filter.paymentMethod = req.query.method;
  if (req.query.cashierId) filter.cashierId = req.query.cashierId;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    Sale.find({ __allowGlobal: true, ...filter })
      .populate('customerId', 'name')
      .populate('patientId', 'name')
      .populate('cashierId', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Sale.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

/* ═════════════════════════════════════════════════════════════════
   GET
   ═════════════════════════════════════════════════════════════════ */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'saleId');
  const sale = await Sale.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .populate('customerId', 'name phone email')
    .populate('patientId', 'name phone')
    .populate('cashierId', 'fullName email')
    .populate('branchId', 'name code address phone')
    .lean();
  if (!sale) throw ApiError.notFound('SALE_NOT_FOUND', 'Sale not found');
  return ok(res, sale);
});

/* ═════════════════════════════════════════════════════════════════
   REFUND
   ═════════════════════════════════════════════════════════════════ */

const refund = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'saleId');
  const { items: refundItems, reason = null, note = null } = req.body;
  if (!Array.isArray(refundItems) || !refundItems.length) {
    throw ApiError.badRequest('EMPTY_REFUND', 'At least one item required');
  }

  const sale = await Sale.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!sale) throw ApiError.notFound('SALE_NOT_FOUND', 'Sale not found');
  if (sale.status === 'refunded' || sale.status === 'voided') {
    throw ApiError.badRequest('ALREADY_REFUNDED', 'Sale already refunded');
  }

  let refundTotal = 0;
  const returnItems = [];

  for (const ri of refundItems) {
    const idx = Number(ri.saleItemIndex);
    const saleItem = sale.items[idx];
    if (!saleItem) throw ApiError.badRequest('INVALID_ITEM', `Invalid saleItemIndex ${idx}`);

    const qty = Number(ri.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > saleItem.qty) {
      throw ApiError.badRequest('INVALID_QTY', `Invalid refund qty for ${saleItem.name}`);
    }

    const refundAmount = qty * saleItem.unitPrice;
    refundTotal += refundAmount;

    returnItems.push({
      saleItemIndex: idx,
      drugId: saleItem.drugId,
      batchId: saleItem.batchId,
      qty,
      refundAmount,
    });

    await Batch.updateOne(
      { __allowGlobal: true, _id: saleItem.batchId },
      { $inc: { qty } }
    );
    await StockMovement.create({
      tenantId: req.tenantId,
      branchId: sale.branchId,
      drugId: saleItem.drugId,
      batchId: saleItem.batchId,
      type: 'returned',
      qty,
      ref: sale.invoiceNo,
      userId: req.user._id,
      note,
    });
  }

  sale.returns.push({
    items: returnItems,
    reason,
    refundAmount: refundTotal,
    processedBy: req.user._id,
    processedAt: new Date(),
    status: 'approved',
    note,
  });

  const allRefunded = sale.items.every((item) => {
    const totalQty = sale.returns
      .flatMap((r) => r.items)
      .filter((ri) => ri.saleItemIndex === sale.items.indexOf(item))
      .reduce((s, ri) => s + ri.qty, 0);
    return totalQty >= item.qty;
  });

  sale.status = allRefunded ? 'refunded' : 'partially_refunded';
  await sale.save();

  return ok(res, sale.toObject());
});

/* ═════════════════════════════════════════════════════════════════
   RECEIPT
   ═════════════════════════════════════════════════════════════════ */

const receipt = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'saleId');
  const sale = await Sale.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  }).lean();
  if (!sale) throw ApiError.notFound('SALE_NOT_FOUND', 'Sale not found');

  if (sale.receiptUrl) return ok(res, { url: sale.receiptUrl });

  return ok(res, { url: null, message: 'Receipt PDF not yet generated' });
});

module.exports = { create, list, get, refund, receipt };