const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const { comparePassword } = require('../../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../../utils/jwt');
const SuperAdmin = require('../../models/admin/SuperAdmin');
const adminActionService = require('../../services/adminActionService');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw ApiError.badRequest('MISSING_FIELDS', 'Email and password required');

  const admin = await SuperAdmin.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!admin) throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  if (admin.status !== 'active') throw ApiError.forbidden('ADMIN_INACTIVE', 'Account is not active');

  const valid = await comparePassword(password, admin.passwordHash);
  if (!valid) throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

  admin.lastLoginAt = new Date();
  await admin.save();

  const payload = { sub: String(admin._id), role: admin.role, scope: 'admin' };

  await adminActionService.log({ adminId: admin._id, action: 'admin.login', ip: req.ip });

  return ok(res, {
    accessToken: signAccessToken(payload, 'admin'),
    refreshToken: signRefreshToken(payload, 'admin').token,
    admin: { id: admin._id, email: admin.email, fullName: admin.fullName, role: admin.role },
  });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.badRequest('NO_REFRESH', 'Refresh token required');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken, 'admin');
  } catch {
    throw ApiError.unauthorized('INVALID_REFRESH', 'Invalid or expired refresh token');
  }

  const admin = await SuperAdmin.findById(payload.sub).lean();
  if (!admin) throw ApiError.unauthorized('ADMIN_NOT_FOUND', 'Admin not found');
  if (admin.status !== 'active') throw ApiError.forbidden('ADMIN_INACTIVE', 'Account is not active');

  const next = { sub: String(admin._id), role: admin.role, scope: 'admin' };

  return ok(res, {
    accessToken: signAccessToken(next, 'admin'),
    refreshToken: signRefreshToken(next, 'admin').token,
  });
});

const logout = asyncHandler(async (req, res) => {
  await adminActionService.log({ adminId: req.admin.id, action: 'admin.logout', ip: req.ip });
  return ok(res, { loggedOut: true });
});

const me = asyncHandler(async (req, res) => {
  const admin = await SuperAdmin.findById(req.admin.id).lean();
  if (!admin) throw ApiError.notFound('ADMIN_NOT_FOUND', 'Admin not found');
  return ok(res, {
    id: admin._id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role,
    lastLoginAt: admin.lastLoginAt,
  });
});

module.exports = { login, refresh, logout, me };