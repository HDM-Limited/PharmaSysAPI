const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const { env } = require('../../config/env');
const { hashPassword, comparePassword } = require('../../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken, verifyAccessToken } = require('../../utils/jwt');
const { slugify } = require('../../utils/slugify');
const { runAsTenant } = require('../../models/plugins/context');

const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Branch = require('../../models/client/Branch');
const Plan = require('../../models/admin/Plan');
const PendingActivation = require('../../models/admin/PendingActivation');
const SuperAdmin = require('../../models/admin/SuperAdmin');
const UserInvitation = require('../../models/client/UserInvitation');
const settingsService = require('../../services/settingsService');
const invoiceService = require('../../services/invoiceService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

async function uniqueSlug(base) {
  let slug = slugify(base);
  if (!slug) slug = `pharmacy-${Date.now()}`;

  let exists = await Tenant.findOne({ slug }).lean();
  let i = 1;
  while (exists) {
    slug = `${slugify(base)}-${i++}`;
    exists = await Tenant.findOne({ slug }).lean();
  }
  return slug;
}

function randomPassword(len = 12) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

async function notifyAdminsOfPending({ tenant, owner }) {
  const admins = await SuperAdmin.find({ status: 'active' }).select('email').lean();
  for (const admin of admins) {
    emailService
      .sendAdminNewPending({
        to: admin.email,
        businessName: tenant.name,
        ownerName: owner.fullName,
        ownerEmail: owner.email,
        ownerPhone: owner.phone,
        country: tenant.country,
        businessType: tenant.businessType,
        registeredAt: tenant.registeredAt.toISOString(),
        reviewUrl: `${env.adminUrl}/pending`,
      })
      .catch(() => {});
  }
}

const register = asyncHandler(async (req, res) => {
  const {
    businessName,
    ownerName,
    email,
    phone,
    country,
    password,
    planCode,
  } = req.body;

  if (!businessName || !ownerName || !email || !password || !planCode) {
    throw ApiError.badRequest('MISSING_FIELDS', 'businessName, ownerName, email, password, planCode required');
  }
  if (password.length < 8) throw ApiError.badRequest('WEAK_PASSWORD', 'Password must be at least 8 characters');

  const open = await settingsService.isRegistrationOpen();
  if (!open) throw ApiError.forbidden('REGISTRATION_CLOSED', 'Registration is closed');

  const existing = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, email: email.toLowerCase() }).lean()
  );
  if (existing) throw ApiError.conflict('EMAIL_TAKEN', 'Email already registered');

  const plan = await Plan.findOne({ code: planCode, isActive: true, isPublic: true }).lean();
  if (!plan) throw ApiError.badRequest('INVALID_PLAN', `Plan '${planCode}' not available`);

  const slug = await uniqueSlug(businessName);
  const passwordHash = await hashPassword(password);
  const now = new Date();

  const tenant = await Tenant.create({
    name: businessName,
    slug,
    country: country || 'KE',
    businessType: 'pharmacy',
    status: 'pending_user',
    planCode: plan.code,
    registeredAt: now,
  });

  const branch = await Branch.create({
    tenantId: tenant._id,
    name: 'Main Branch',
    code: 'MAIN-01',
    isActive: true,
  });

  const owner = await User.create({
    tenantId: tenant._id,
    branchIds: [branch._id],
    email: email.toLowerCase(),
    phone: phone || null,
    fullName: ownerName,
    role: 'owner',
    status: 'pending',
    passwordHash,
    emailVerified: true,
  });

  tenant.ownerId = owner._id;
  await tenant.save();

  await PendingActivation.create({
    tenantId: tenant._id,
    status: 'pending',
    priority: 'normal',
    registeredAt: now,
    slaDeadline: new Date(now.getTime() + 48 * 3600 * 1000),
  });

  let invoice = null;
  if (plan.price?.amount > 0) {
    try {
      const result = await invoiceService.generateSubscriptionInvoice({ tenantId: tenant._id, owner, tenant, plan });
      invoice = result.invoice;
    } catch (err) {
      // logged inside invoiceService
    }
  }

  if (owner.email) {
    emailService
      .sendRegistrationReceived({
        tenantId: tenant._id,
        to: owner.email,
        name: owner.fullName,
        businessName: tenant.name,
        planName: plan.name,
        amount: plan.price?.amount || 0,
        currency: plan.price?.currency || 'KES',
        dueDate: invoice?.dueDate ? invoice.dueDate.toISOString() : null,
        invoiceNumber: invoice?.invoiceNumber || null,
        paymentLink: invoice ? `${env.appUrl}/invoice/${invoice.invoiceNumber}` : null,
      })
      .catch(() => {});

    if (invoice) {
      emailService
        .sendInvoice({
          tenantId: tenant._id,
          to: owner.email,
          businessName: tenant.name,
          customerName: owner.fullName,
          invoiceNumber: invoice.invoiceNumber,
          items: invoice.items,
          subtotal: invoice.subtotal,
          discount: invoice.discount,
          tax: invoice.tax,
          total: invoice.total,
          amountDue: invoice.amountDue,
          currency: invoice.currency,
          dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
          issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
          notes: invoice.notes,
          instructions: invoice.paymentInstructions,
          payUrl: `${env.appUrl}/invoice/${invoice.invoiceNumber}`,
        })
        .catch(() => {});
    }
  }

  notifyAdminsOfPending({ tenant, owner }).catch(() => {});

  const payload = {
    sub: String(owner._id),
    tenantId: String(tenant._id),
    role: owner.role,
    branchIds: owner.branchIds.map(String),
    scope: 'pending',
  };

  return created(res, {
    user: { id: owner._id, fullName: owner.fullName, email: owner.email, role: owner.role, status: owner.status },
    tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status, planCode: tenant.planCode },
    plan: { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features },
    invoice: invoice
      ? {
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          amountDue: invoice.amountDue,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          issuedAt: invoice.issuedAt,
          status: invoice.status,
          paymentInstructions: invoice.paymentInstructions || [],
        }
      : null,
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw ApiError.badRequest('MISSING_FIELDS', 'Email and password required');

  const user = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, email: email.toLowerCase() }).select('+passwordHash')
  );
  if (!user) throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

  if (['rejected', 'suspended'].includes(user.status)) {
    throw ApiError.forbidden('ACCOUNT_BLOCKED', `Account ${user.status}. Contact support.`);
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

  const tenant = await Tenant.findById(user.tenantId).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  if (['rejected', 'suspended', 'expired'].includes(tenant.status)) {
    throw ApiError.forbidden('TENANT_BLOCKED', `Tenant ${tenant.status}`);
  }

  const scope = tenant.status === 'active' ? 'active' : 'pending';
  const payload = {
    sub: String(user._id),
    tenantId: String(tenant._id),
    role: user.role,
    branchIds: (user.branchIds || []).map(String),
    scope,
  };

  user.lastLoginAt = new Date();
  await user.save();

  const plan = await Plan.findOne({ code: tenant.planCode }).lean();

  return ok(res, {
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
    },
    tenant: { id: tenant._id, name: tenant.name, status: tenant.status, planCode: tenant.planCode },
    plan: plan ? { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features } : null,
    scope,
  });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.badRequest('NO_REFRESH', 'Refresh token required');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken, 'tenant');
  } catch {
    throw ApiError.unauthorized('INVALID_REFRESH', 'Invalid or expired refresh token');
  }

  const user = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, _id: payload.sub })
  );
  if (!user) throw ApiError.unauthorized('USER_NOT_FOUND', 'User not found');
  if (!['active', 'pending'].includes(user.status)) throw ApiError.forbidden('USER_BLOCKED', 'Account is not active');

  const tenant = await Tenant.findById(user.tenantId).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const scope = tenant.status === 'active' ? 'active' : 'pending';
  const next = {
    sub: String(user._id),
    tenantId: String(tenant._id),
    role: user.role,
    branchIds: (user.branchIds || []).map(String),
    scope,
  };

  return ok(res, {
    accessToken: signAccessToken(next, 'tenant'),
    refreshToken: signRefreshToken(next, 'tenant').token,
  });
});

const logout = asyncHandler(async (req, res) => {
  return ok(res, { loggedOut: true });
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  const tenant = await Tenant.findById(req.tenantId).lean();
  const plan = await Plan.findOne({ code: tenant.planCode }).lean();

  return ok(res, {
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      branchIds: user.branchIds,
    },
    tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status, planCode: tenant.planCode },
    plan: plan ? { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features } : null,
    scope: req.scope,
  });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('EMAIL_REQUIRED', 'Email required');

  const user = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, email: email.toLowerCase() })
  );
  if (!user) return ok(res, { sent: true });

  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken = token;
  user.resetExpiresAt = new Date(Date.now() + 3600 * 1000);
  await user.save();

  emailService
    .sendPasswordReset({
      tenantId: user.tenantId,
      to: user.email,
      fullName: user.fullName,
      resetUrl: `${env.appUrl}/reset-password?token=${token}`,
      expiresIn: '1 hour',
    })
    .catch(() => {});

  return ok(res, { sent: true });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) throw ApiError.badRequest('MISSING_FIELDS', 'token and newPassword required');
  if (newPassword.length < 8) throw ApiError.badRequest('WEAK_PASSWORD', 'Password must be at least 8 characters');

  const user = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, resetToken: token }).select('+resetToken')
  );
  if (!user) throw ApiError.badRequest('INVALID_TOKEN', 'Invalid or expired token');
  if (user.resetExpiresAt && user.resetExpiresAt < new Date()) {
    throw ApiError.badRequest('TOKEN_EXPIRED', 'Reset token expired');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetToken = undefined;
  user.resetExpiresAt = undefined;
  await user.save();

  emailService
    .sendPasswordChanged({
      tenantId: user.tenantId,
      to: user.email,
      fullName: user.fullName,
      when: new Date().toISOString(),
      ip: req.ip,
    })
    .catch(() => {});

  return ok(res, { reset: true });
});

const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password, fullName } = req.body;
  if (!token || !password) throw ApiError.badRequest('MISSING_FIELDS', 'token and password required');
  if (password.length < 8) throw ApiError.badRequest('WEAK_PASSWORD', 'Password must be at least 8 characters');

  const inv = await runAsTenant({ allowGlobal: true }, () =>
    UserInvitation.findOne({ __allowGlobal: true, token, acceptedAt: null })
  );
  if (!inv) throw ApiError.badRequest('INVALID_INVITE', 'Invalid or expired invitation');
  if (inv.expiresAt < new Date()) throw ApiError.badRequest('INVITE_EXPIRED', 'Invitation expired');

  const user = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, _id: inv.userId })
  );
  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');

  user.passwordHash = await hashPassword(password);
  if (fullName) user.fullName = fullName;
  user.status = 'active';
  user.mustChangePassword = false;
  await user.save();

  inv.acceptedAt = new Date();
  await inv.save();

  const tenant = await Tenant.findById(user.tenantId).lean();
  const scope = tenant?.status === 'active' ? 'active' : 'pending';
  const payload = {
    sub: String(user._id),
    tenantId: String(user.tenantId),
    role: user.role,
    branchIds: (user.branchIds || []).map(String),
    scope,
  };

  return ok(res, {
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
    user: { id: user._id, email: user.email, role: user.role },
  });
});

const impersonateExchange = asyncHandler(async (req, res) => {
  const { impToken } = req.body;
  if (!impToken) throw ApiError.badRequest('MISSING_FIELDS', 'impToken required');

  let payload;
  try {
    payload = verifyAccessToken(impToken, 'tenant');
  } catch {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Invalid impersonation token');
  }

  if (!payload.impersonatedBy) throw ApiError.forbidden('NOT_IMPERSONATION', 'Not an impersonation token');

  const user = await runAsTenant({ allowGlobal: true }, () =>
    User.findOne({ __allowGlobal: true, _id: payload.sub })
  );
  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');

  const tenant = await Tenant.findById(user.tenantId).lean();
  const scope = tenant?.status === 'active' ? 'active' : 'pending';

  const next = {
    sub: String(user._id),
    tenantId: String(user.tenantId),
    role: user.role,
    branchIds: (user.branchIds || []).map(String),
    scope,
    impersonatedBy: payload.impersonatedBy,
  };

  return ok(res, {
    accessToken: signAccessToken(next, 'tenant'),
    refreshToken: signRefreshToken(next, 'tenant').token,
    user: { id: user._id, email: user.email, role: user.role },
    impersonatedBy: payload.impersonatedBy,
  });
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  acceptInvite,
  impersonateExchange,
};