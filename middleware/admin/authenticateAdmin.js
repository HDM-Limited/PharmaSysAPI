const { ApiError } = require('../../utils/apiError');
const { verifyAccessToken } = require('../../utils/jwt');
const { runAsAdmin } = require('../../models/plugins/context');
const SuperAdmin = require('../../models/admin/SuperAdmin');

async function authenticateAdmin(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw ApiError.unauthorized('NO_TOKEN', 'No admin token provided');
    }

    let payload;
    try {
      payload = verifyAccessToken(token, 'admin');
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('TOKEN_EXPIRED', 'Admin token expired');
      }
      if (err.name === 'JsonWebTokenError') {
        throw ApiError.unauthorized('INVALID_TOKEN', 'Invalid admin token');
      }
      if (err.name === 'NotBeforeError') {
        throw ApiError.unauthorized('TOKEN_NOT_ACTIVE', 'Admin token not active');
      }
      throw err;
    }

    if (payload.scope !== 'admin') {
      throw ApiError.forbidden('NOT_ADMIN', 'Admin token required');
    }

    const admin = await SuperAdmin.findById(payload.sub).lean();
    if (!admin) {
      throw ApiError.unauthorized('ADMIN_NOT_FOUND', 'Admin not found');
    }
    if (admin.status !== 'active') {
      throw ApiError.forbidden('ADMIN_INACTIVE', 'Admin account is not active');
    }

    req.admin = {
      id: String(admin._id),
      role: admin.role,
      email: admin.email,
    };

    runAsAdmin({ isAdmin: true, adminId: String(admin._id) }, () => next());
  } catch (err) {
    next(err);
  }
}

module.exports = authenticateAdmin;