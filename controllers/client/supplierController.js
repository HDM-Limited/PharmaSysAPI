const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, noContent } = require('../../utils/apiResponse');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const Supplier = require('../../models/client/Supplier');

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const filter = { tenantId: req.tenantId, isActive: true };
  if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };

  const items = await Supplier.find({ __allowGlobal: true, ...filter }).sort({ name: 1 }).lean();
  return ok(res, items);
});

/* ─────────────── GET ─────────────── */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'supplierId');
  const supplier = await Supplier.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  }).lean();
  if (!supplier) throw ApiError.notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
  return ok(res, supplier);
});

/* ─────────────── CREATE ─────────────── */

const create = asyncHandler(async (req, res) => {
  const { name, contactPerson, phone, email, address } = req.body;
  if (!name) throw ApiError.badRequest('MISSING_FIELDS', 'name required');

  const supplier = await Supplier.create({
    tenantId: req.tenantId,
    name: name.trim(),
    contactPerson: contactPerson || null,
    phone: phone || null,
    email: email || null,
    address: address || null,
    isActive: true,
  });
  return created(res, supplier.toObject());
});

/* ─────────────── UPDATE ─────────────── */

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'supplierId');
  const allowed = ['name', 'contactPerson', 'phone', 'email', 'address'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const supplier = await Supplier.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!supplier) throw ApiError.notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
  return ok(res, supplier);
});

/* ─────────────── REMOVE (soft or hard) ─────────────── */

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'supplierId');
  const hard = String(req.query.hard) === 'true';

  if (hard && req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can permanently delete suppliers');
  }

  if (hard) {
    const result = await Supplier.deleteOne({
      __allowGlobal: true,
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (result.deletedCount === 0) {
      throw ApiError.notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
    }
    return ok(res, { deleted: true, permanent: true });
  }

  const result = await Supplier.updateOne(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false } }
  );
  if (result.matchedCount === 0) {
    throw ApiError.notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  return noContent(res);
});

module.exports = { list, get, create, update, remove };