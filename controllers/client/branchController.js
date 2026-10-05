const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, noContent } = require('../../utils/apiResponse');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const Branch = require('../../models/client/Branch');
const User = require('../../models/client/User');
const Plan = require('../../models/admin/Plan');
const Tenant = require('../../models/admin/Tenant');

/* ═════════════════════════════════════════════════════════════════
   LIST
   ═════════════════════════════════════════════════════════════════ */

const list = asyncHandler(async (req, res) => {
  const filter = { tenantId: req.tenantId };
  if (req.user.role !== 'owner') {
    filter._id = { $in: req.branchIds };
  }
  const items = await Branch.find({ __allowGlobal: true, ...filter })
    .sort({ createdAt: 1 })
    .lean();
  return ok(res, items);
});

/* ═════════════════════════════════════════════════════════════════
   GET
   ═════════════════════════════════════════════════════════════════ */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'branchId');
  const branch = await Branch.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  }).lean();
  if (!branch) throw ApiError.notFound('BRANCH_NOT_FOUND', 'Branch not found');

  if (req.user.role !== 'owner' && !req.branchIds.includes(String(branch._id))) {
    throw ApiError.forbidden('BRANCH_FORBIDDEN', 'You do not have access to this branch');
  }
  return ok(res, branch);
});

/* ═════════════════════════════════════════════════════════════════
   CREATE
   ═════════════════════════════════════════════════════════════════ */

const create = asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can create branches');
  }

  const { name, code, address, phone, email } = req.body;
  if (!name || !code) {
    throw ApiError.badRequest('MISSING_FIELDS', 'name and code required');
  }

  const tenant = await Tenant.findById(req.tenantId).select('planCode').lean();
  const plan = await Plan.findOne({ code: tenant.planCode }).lean();
  const max = plan?.limits?.maxBranches ?? 1;

  const current = await Branch.countDocuments({
    __allowGlobal: true,
    tenantId: req.tenantId,
    isActive: true,
  });
  if (current >= max) {
    throw ApiError.badRequest(
      'LIMIT_BRANCHES',
      `Plan '${plan?.name || 'current'}' allows ${max} branch(es)`
    );
  }

  const branch = await Branch.create({
    tenantId: req.tenantId,
    name: name.trim(),
    code: String(code).trim().toUpperCase(),
    address: address || null,
    phone: phone || null,
    email: email || null,
    isActive: true,
    createdBy: req.user._id,
  });

  // Keep owners in sync — new branch is immediately accessible to them
  await User.updateMany(
    { __allowGlobal: true, tenantId: req.tenantId, role: 'owner' },
    { $addToSet: { branchIds: branch._id } }
  );

  return created(res, branch.toObject());
});

/* ═════════════════════════════════════════════════════════════════
   UPDATE
   ═════════════════════════════════════════════════════════════════ */

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'branchId');
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can edit branches');
  }

  const allowed = ['name', 'code', 'address', 'phone', 'email', 'managerId'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (patch.code) patch.code = String(patch.code).trim().toUpperCase();

  const branch = await Branch.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!branch) throw ApiError.notFound('BRANCH_NOT_FOUND', 'Branch not found');
  return ok(res, branch);
});

/* ═════════════════════════════════════════════════════════════════
   DEACTIVATE
   ═════════════════════════════════════════════════════════════════ */

const deactivate = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'branchId');
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can deactivate branches');
  }

  const branch = await Branch.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!branch) throw ApiError.notFound('BRANCH_NOT_FOUND', 'Branch not found');

  const active = await Branch.countDocuments({
    __allowGlobal: true,
    tenantId: req.tenantId,
    isActive: true,
  });
  if (active <= 1) {
    throw ApiError.badRequest('LAST_BRANCH', 'Cannot deactivate the only active branch');
  }

  branch.isActive = false;
  await branch.save();
  return ok(res, { deactivated: true });
});

module.exports = { list, get, create, update, deactivate };