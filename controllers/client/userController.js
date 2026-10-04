const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, noContent } = require('../../utils/apiResponse');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { hashPassword } = require('../../utils/password');
const { env } = require('../../config/env');

const User = require('../../models/client/User');
const Branch = require('../../models/client/Branch');
const UserInvitation = require('../../models/client/UserInvitation');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

const list = asyncHandler(async (req, res) => {
  if (req.user.role === 'cashier') {
    throw ApiError.forbidden('FORBIDDEN', 'Cashiers cannot list staff');
  }

  const filter = { tenantId: req.tenantId };
  if (req.user.role === 'branch_manager') {
    filter.branchIds = { $in: req.branchIds };
    filter.role = { $ne: 'owner' };
  }

  const items = await User.find({ __allowGlobal: true, ...filter })
    .select('fullName email phone role status branchIds lastLoginAt createdAt')
    .sort({ createdAt: 1 })
    .lean();

  return ok(res, items);
});

const invite = asyncHandler(async (req, res) => {
  if (req.user.role === 'cashier') {
    throw ApiError.forbidden('FORBIDDEN', 'Cashiers cannot invite staff');
  }

  const { email, fullName, phone, role, branchId } = req.body;
  if (!email || !fullName || !role) {
    throw ApiError.badRequest('MISSING_FIELDS', 'email, fullName, role required');
  }
  if (!['branch_manager', 'cashier'].includes(role)) {
    throw ApiError.badRequest('INVALID_ROLE', 'Role must be branch_manager or cashier');
  }
  if (req.user.role === 'branch_manager' && role !== 'cashier') {
    throw ApiError.forbidden('FORBIDDEN', 'Branch managers can only invite cashiers');
  }

  const targetBranchId = req.user.role === 'branch_manager' ? req.branchIds[0] : branchId;
  if (!targetBranchId) throw ApiError.badRequest('BRANCH_REQUIRED', 'branchId is required');
  if (req.user.role !== 'owner' && !req.branchIds.includes(String(targetBranchId))) {
    throw ApiError.forbidden('BRANCH_FORBIDDEN', 'You do not have access to this branch');
  }

  const branch = await Branch.findOne({
    __allowGlobal: true,
    _id: targetBranchId,
    tenantId: req.tenantId,
  }).lean();
  if (!branch) throw ApiError.notFound('BRANCH_NOT_FOUND', 'Branch not found');

  const existing = await User.findOne({ __allowGlobal: true, email: email.toLowerCase() }).lean();
  if (existing) throw ApiError.conflict('EMAIL_TAKEN', 'Email already registered');

  const tenant = await Tenant.findById(req.tenantId).select('name planCode').lean();
  const plan = await Plan.findOne({ code: tenant.planCode }).lean();
  const limitKey = role === 'branch_manager' ? 'maxManagersPerBranch' : 'maxCashiersPerBranch';
  const max = plan?.limits?.[limitKey] ?? 1;

  const current = await User.countDocuments({
    __allowGlobal: true,
    tenantId: req.tenantId,
    role,
    branchIds: targetBranchId,
    status: { $in: ['active', 'pending'] },
  });
  if (current >= max) {
    throw ApiError.badRequest('LIMIT_REACHED', `Plan allows ${max} ${role}(s) per branch`);
  }

  const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
  const passwordHash = await hashPassword(tempPassword);

  const user = await User.create({
    tenantId: req.tenantId,
    branchIds: [targetBranchId],
    email: email.toLowerCase(),
    phone: phone || null,
    fullName,
    role,
    status: 'pending',
    passwordHash,
    mustChangePassword: true,
    invitedBy: req.user._id,
  });

  const token = crypto.randomBytes(32).toString('hex');
  await UserInvitation.create({
    tenantId: req.tenantId,
    userId: user._id,
    branchId: targetBranchId,
    email: user.email,
    token,
    role,
    invitedBy: req.user._id,
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
  });

  if (user.email) {
    emailService
      .sendStaffWelcome({
        tenantId: req.tenantId,
        recipientId: user._id,
        to: user.email,
        fullName: user.fullName,
        businessName: tenant.name,
        email: user.email,
        temporaryPassword: tempPassword,
        role,
        loginUrl: `${env.appUrl}/accept-invite?token=${token}`,
      })
      .catch(() => {});
  }
  if (user.phone) {
    smsService
      .sendStaffWelcome({
        tenantId: req.tenantId,
        recipientId: user._id,
        to: user.phone,
        businessName: tenant.name,
        role,
        loginUrl: `${env.appUrl}/accept-invite?token=${token}`,
      })
      .catch(() => {});
  }

  return created(res, { invited: true, user: user.toObject() });
});

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'userId');
  if (req.user.role === 'cashier') {
    throw ApiError.forbidden('FORBIDDEN', 'Cashiers cannot manage users');
  }

  const target = await User.findOne({ __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId });
  if (!target) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  if (target.role === 'owner') throw ApiError.forbidden('CANNOT_EDIT_OWNER', 'Cannot modify the owner');

  if (req.user.role === 'branch_manager') {
    if (!req.branchIds.includes(String(target.branchIds?.[0]))) {
      throw ApiError.forbidden('FORBIDDEN', 'You can only manage staff in your branch');
    }
    if (target.role === 'branch_manager') {
      throw ApiError.forbidden('FORBIDDEN', 'Managers cannot modify other managers');
    }
  }

  const allowed = ['fullName', 'phone', 'status'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const updated = await User.findOneAndUpdate(
    { __allowGlobal: true, _id: target._id },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  return ok(res, updated);
});

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'userId');
  if (req.user.role === 'cashier') {
    throw ApiError.forbidden('FORBIDDEN', 'Cashiers cannot remove users');
  }

  const target = await User.findOne({ __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId });
  if (!target) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  if (target.role === 'owner') throw ApiError.forbidden('CANNOT_REMOVE_OWNER', 'Cannot remove the owner');
  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest('CANNOT_REMOVE_SELF', 'Cannot remove yourself');
  }
  if (req.user.role === 'branch_manager' && !req.branchIds.includes(String(target.branchIds?.[0]))) {
    throw ApiError.forbidden('FORBIDDEN', 'You can only remove staff in your branch');
  }

  target.status = 'suspended';
  await target.save();

  const tenant = await Tenant.findById(req.tenantId).select('name').lean();
  if (target.email) {
    emailService
      .sendStaffDeactivated({
        tenantId: req.tenantId,
        to: target.email,
        fullName: target.fullName,
        businessName: tenant?.name || 'PharmaSys',
      })
      .catch(() => {});
  }

  return noContent(res);
});

module.exports = { list, invite, update, remove };