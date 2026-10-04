const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { signAccessToken } = require('../../utils/jwt');
const { env } = require('../../config/env');

const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Branch = require('../../models/client/Branch');
const Plan = require('../../models/admin/Plan');
const adminActionService = require('../../services/adminActionService');
const planService = require('../../services/planService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, country, search } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (country) filter.country = country;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const [items, total] = await Promise.all([
    Tenant.find(filter).sort({ registeredAt: -1 }).skip(skip).limit(limit).lean(),
    Tenant.countDocuments(filter),
  ]);

  return paginated(res, items, page, limit, total);
});

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');
  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const [owner, branches, staffCount] = await Promise.all([
    User.findOne({ tenantId: tenant._id, role: 'owner' }).select('fullName email phone status').lean(),
    Branch.find({ tenantId: tenant._id }).select('name code isActive').lean(),
    User.countDocuments({ tenantId: tenant._id, status: 'active' }),
  ]);

  return ok(res, {
    tenant,
    owner,
    branches,
    counts: { staff: staffCount, branches: branches.length },
  });
});

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const allowed = ['name', 'country', 'planCode'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  if (patch.planCode) {
    const plan = await Plan.findOne({ code: patch.planCode }).lean();
    if (!plan) throw ApiError.badRequest('INVALID_PLAN', `Plan '${patch.planCode}' not found`);
  }

  const tenant = await Tenant.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  if (patch.planCode) planService.invalidateCache(patch.planCode);

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.update',
    metadata: patch,
    ip: req.ip,
  });

  return ok(res, tenant);
});

const suspend = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  tenant.status = 'suspended';
  tenant.suspendedAt = new Date();
  tenant.suspendedBy = req.admin.id;
  tenant.suspendedReason = req.body.reason || null;
  await tenant.save();

  await User.updateMany({ tenantId: tenant._id }, { $set: { status: 'suspended' } });

  const owner = await User.findOne({ tenantId: tenant._id, role: 'owner' }).lean();
  if (owner?.email) {
    emailService
      .sendStaffDeactivated({
        tenantId: tenant._id,
        to: owner.email,
        fullName: owner.fullName,
        businessName: tenant.name,
      })
      .catch(() => {});
  }

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.suspend',
    reason: req.body.reason || null,
    ip: req.ip,
  });

  return ok(res, { suspended: true });
});

const reactivate = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  tenant.status = 'active';
  tenant.suspendedAt = null;
  tenant.suspendedBy = null;
  tenant.suspendedReason = null;
  await tenant.save();

  await User.updateMany(
    { tenantId: tenant._id, status: 'suspended' },
    { $set: { status: 'active' } }
  );

  const owner = await User.findOne({ tenantId: tenant._id, role: 'owner' }).lean();
  if (owner?.email) {
    emailService
      .sendTenantReactivated({
        tenantId: tenant._id,
        to: owner.email,
        fullName: owner.fullName,
        businessName: tenant.name,
        loginUrl: `${env.appUrl}/login`,
      })
      .catch(() => {});
  }

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.reactivate',
    ip: req.ip,
  });

  return ok(res, { reactivated: true });
});

const impersonate = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const owner = await User.findOne({ tenantId: tenant._id, role: 'owner' }).lean();
  if (!owner) throw ApiError.notFound('OWNER_NOT_FOUND', 'Owner not found');

  const token = signAccessToken(
    {
      sub: String(owner._id),
      tenantId: String(tenant._id),
      role: 'owner',
      branchIds: [],
      scope: 'active',
      impersonatedBy: String(req.admin.id),
    },
    'tenant'
  );

  await adminActionService.log({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.impersonate',
    ip: req.ip,
  });

  return ok(res, {
    accessToken: token,
    tenant: { id: tenant._id, name: tenant.name },
    owner: { id: owner._id, email: owner.email, fullName: owner.fullName },
  });
});

module.exports = { list, get, update, suspend, reactivate, impersonate };