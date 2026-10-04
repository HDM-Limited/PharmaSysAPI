const { ApiError } = require('../../utils/apiError');
const { verifyAccessToken } = require('../../utils/jwt');
const User = require('../../models/client/User');
const Tenant = require('../../models/admin/Tenant');

async function authenticateTenant(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('NO_TOKEN', 'No token provided');

    let payload;
    try {
      payload = verifyAccessToken(token, 'tenant');
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('TOKEN_EXPIRED', 'Token expired');
      if (err.name === 'JsonWebTokenError') throw ApiError.unauthorized('INVALID_TOKEN', 'Invalid token');
      if (err.name === 'NotBeforeError') throw ApiError.unauthorized('TOKEN_NOT_ACTIVE', 'Token not active');
      throw err;
    }

    if (!payload.tenantId) throw ApiError.unauthorized('INVALID_TOKEN', 'Invalid token payload');

    const tenant = await Tenant.findById(payload.tenantId).lean();
    if (!tenant) throw ApiError.unauthorized('TENANT_NOT_FOUND', 'Tenant not found');

    if (['rejected', 'suspended'].includes(tenant.status)) {
      throw ApiError.forbidden('TENANT_BLOCKED', `Tenant ${tenant.status}`);
    }

    // ── STRICT EXPIRY GATE — 402, not 403 ──
    if (tenant.status === 'expired' || (tenant.expiresAt && new Date(tenant.expiresAt).getTime() < Date.now())) {
      // Lazy DB cleanup so subsequent requests short-circuit
      Tenant.updateOne(
        { _id: tenant._id, status: 'active' },
        { $set: { status: 'expired' } }
      ).catch(() => {});

      const Subscription = require('../../models/admin/Subscription');
      Subscription.updateOne(
        { tenantId: tenant._id, status: 'active' },
        { $set: { status: 'expired' } }
      ).catch(() => {});

      throw ApiError.paymentRequired(
        'SUBSCRIPTION_EXPIRED',
        'Your subscription has expired. Renew to continue.',
        {
          expiresAt: tenant.expiresAt,
          planCode: tenant.planCode,
          tenantName: tenant.name,
        }
      );
    }
    // ────────────────────────

    const user = await User.findOne({ __allowGlobal: true, _id: payload.sub }).lean();
    if (!user) throw ApiError.unauthorized('USER_NOT_FOUND', 'User not found');
    if (!['active', 'pending'].includes(user.status)) {
      throw ApiError.forbidden('USER_BLOCKED', 'User is not active');
    }

    req.user = user;
    req.tenantId = tenant._id;
    req.tenant = tenant;
    req.branchIds = (user.branchIds || []).map(String);
    req.scope = tenant.status === 'active' ? 'active' : 'pending';

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticateTenant;