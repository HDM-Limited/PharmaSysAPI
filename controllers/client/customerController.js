const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, noContent, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const Customer = require('../../models/client/Customer');
const Sale = require('../../models/client/Sale');

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId, isActive: true };
  if (req.query.search) {
    filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { phone: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    Customer.find({ __allowGlobal: true, ...filter }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Customer.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'customerId');
  const customer = await Customer.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  }).lean();
  if (!customer) throw ApiError.notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
  return ok(res, customer);
});

const create = asyncHandler(async (req, res) => {
  const { name, phone, email, address, notes } = req.body;
  if (!name) throw ApiError.badRequest('MISSING_FIELDS', 'name required');

  const customer = await Customer.create({
    tenantId: req.tenantId,
    name: name.trim(),
    phone: phone || null,
    email: email || null,
    address: address || null,
    notes: notes || null,
    isActive: true,
  });

  return created(res, customer.toObject());
});

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'customerId');
  const allowed = ['name', 'phone', 'email', 'address', 'notes'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const customer = await Customer.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!customer) throw ApiError.notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
  return ok(res, customer);
});

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'customerId');
  const result = await Customer.updateOne(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false } }
  );
  if (result.matchedCount === 0) throw ApiError.notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
  return noContent(res);
});

const purchases = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'customerId');
  const items = await Sale.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    customerId: req.params.id,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return ok(res, items);
});

module.exports = { list, get, create, update, remove, purchases };