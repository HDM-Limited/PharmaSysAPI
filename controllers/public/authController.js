const crypto = require('crypto');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const { hashPassword, comparePassword } = require('../../utils/password');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
} = require('../../utils/jwt');
const { slugify } = require('../../utils/slugify');
const { generateInvoiceNumber } = require('../../utils/invoiceNumber');
const { env } = require('../../config/env');

const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Branch = require('../../models/client/Branch');
const Plan = require('../../models/admin/Plan');
const PendingActivation = require('../../models/admin/PendingActivation');
const SuperAdmin = require('../../models/admin/SuperAdmin');
const UserInvitation = require('../../models/client/UserInvitation');
const Invoice = require('../../models/client/Invoice');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const paymentInstructionsService = require('../../services/paymentInstructionsService');

/* ─────────────── helpers ─────────────── */

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

function buildSessionPayload(user, tenant) {
  const scope = tenant.status === 'active' ? 'active' : 'pending';
  return {
    sub: String(user._id),
    tenantId: String(tenant._id),
    role: user.role,
    branchIds: (user.branchIds || []).map(String),
    scope,
  };
}

/* ─────────────── REGISTER ─────────────── */

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
    throw ApiError.badRequest(
      'MISSING_FIELDS',
      'businessName, ownerName, email, password, planCode required'
    );
  }
  if (password.length < 8) {
    throw ApiError.badRequest('WEAK_PASSWORD', 'Password must be at least 8 characters');
  }

  const existing = await User.findOne({ __allowGlobal: true, email: email.toLowerCase() }).lean();
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

  /* ─── Invoice (if paid plan) ─── */
  let invoice = null;
  const planAmount = plan.price?.amount || 0;

  if (planAmount > 0) {
    const invoiceNumber = generateInvoiceNumber('INV');
    const dueDate = new Date(now.getTime() + 3 * 3600 * 1000);
    const currency = plan.price.currency || 'KES';

    const instructions = await paymentInstructionsService
      .getPaymentInstructions({ amount: planAmount, currency, invoiceNumber })
      .catch(() => []);

    invoice = await Invoice.create({
      tenantId: tenant._id,
      invoiceNumber,
      customerSnapshot: {
        name: owner.fullName,
        email: owner.email,
        phone: owner.phone || null,
        address: null,
      },
      items: [
        {
          productId: null,
          name: `${plan.name} Plan`,
          description: `${plan.price.interval} · ${tenant.name}`,
          qty: 1,
          unitPrice: planAmount,
          subtotal: planAmount,
        },
      ],
      subtotal: planAmount,
      discount: 0,
      tax: 0,
      total: planAmount,
      amountPaid: 0,
      amountDue: planAmount,
      currency,
      status: 'sent',
      dueDate,
      issuedAt: now,
      sentAt: now,
      notes: 'Payment due within 3 hours.',
      paymentInstructions: instructions,
      createdBy: owner._id,
    });
  }

  /* ─── Emails ─── */
  if (owner.email) {
    emailService
      .sendRegistrationReceived({
        tenantId: tenant._id,
        to: owner.email,
        name: owner.fullName,
        businessName: tenant.name,
        planName: plan.name,
        amount: planAmount,
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
          dueDate: invoice.dueDate.toISOString(),
          issuedAt: invoice.issuedAt.toISOString(),
          notes: invoice.notes,
          instructions: invoice.paymentInstructions,
          payUrl: `${env.appUrl}/invoice/${invoice.invoiceNumber}`,
        })
        .catch(() => {});
    }
  }

  notifyAdminsOfPending({ tenant, owner }).catch(() => {});

  const payload = buildSessionPayload(owner, tenant);

  return created(res, {
    user: {
      id: owner._id,
      fullName: owner.fullName,
      email: owner.email,
      phone: owner.phone,
      role: owner.role,
      status: owner.status,
      branchIds: owner.branchIds,
    },
    tenant: {
      id: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      planCode: tenant.planCode,
    },
    plan: {
      code: plan.code,
      name: plan.name,
      limits: plan.limits,
      features: plan.features,
    },
    invoice: invoice
      ? {
          invoiceNumber: invoice.invoiceNumber,
          items: invoice.items,
          subtotal: invoice.subtotal,
          discount: invoice.discount,
          tax: invoice.tax,
          total: invoice.total,
          amountPaid: invoice.amountPaid,
          amountDue: invoice.amountDue,
          currency: invoice.currency,
          status: invoice.status,
          issuedAt: invoice.issuedAt,
          dueDate: invoice.dueDate,
          notes: invoice.notes,
          paymentInstructions: invoice.paymentInstructions || [],
        }
      : null,
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
    scope: 'pending',
  });
});

/* ─────────────── LOGIN ─────────────── */

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw ApiError.badRequest('MISSING_FIELDS', 'Email and password required');
  }

  const user = await User.findOne({ __allowGlobal: true, email: email.toLowerCase() })
    .select('+passwordHash');
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

  const payload = buildSessionPayload(user, tenant);
  const scope = payload.scope;

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
      branchIds: user.branchIds,
      mustChangePassword: user.mustChangePassword,
    },
    tenant: {
      id: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      planCode: tenant.planCode,
    },
    plan: plan
      ? { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features }
      : null,
    scope,
  });
});

/* ─────────────── REFRESH ─────────────── */

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.badRequest('NO_REFRESH', 'Refresh token required');

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken, 'tenant');
  } catch {
    throw ApiError.unauthorized('INVALID_REFRESH', 'Invalid or expired refresh token');
  }

  const user = await User.findOne({ __allowGlobal: true, _id: decoded.sub });
  if (!user) throw ApiError.unauthorized('USER_NOT_FOUND', 'User not found');
  if (!['active', 'pending'].includes(user.status)) {
    throw ApiError.forbidden('USER_BLOCKED', 'Account is not active');
  }

  const tenant = await Tenant.findById(user.tenantId).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const payload = buildSessionPayload(user, tenant);

  return ok(res, {
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
    scope: payload.scope,
  });
});

/* ─────────────── LOGOUT ─────────────── */

const logout = asyncHandler(async (_req, res) => {
  return ok(res, { loggedOut: true });
});

/* ─────────────── ME ─────────────── */

const me = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    __allowGlobal: true,
    _id: req.user._id,
    tenantId: req.tenantId,
  }).lean();

  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');

  const tenant = await Tenant.findById(req.tenantId).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

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
      mustChangePassword: user.mustChangePassword,
    },
    tenant: {
      id: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      planCode: tenant.planCode,
    },
    plan: plan
      ? { code: plan.code, name: plan.name, limits: plan.limits, features: plan.features }
      : null,
    scope: tenant.status === 'active' ? 'active' : 'pending',
  });
});

/* ─────────────── FORGOT PASSWORD ─────────────── */

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('EMAIL_REQUIRED', 'Email required');

  const user = await User.findOne({ __allowGlobal: true, email: email.toLowerCase() });
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

/* ─────────────── RESET PASSWORD ─────────────── */

const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    throw ApiError.badRequest('MISSING_FIELDS', 'token and newPassword required');
  }
  if (newPassword.length < 8) {
    throw ApiError.badRequest('WEAK_PASSWORD', 'Password must be at least 8 characters');
  }

  const user = await User.findOne({ __allowGlobal: true, resetToken: token }).select('+resetToken');
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

/* ─────────────── ACCEPT INVITE ─────────────── */

const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password, fullName } = req.body;
  if (!token || !password) {
    throw ApiError.badRequest('MISSING_FIELDS', 'token and password required');
  }
  if (password.length < 8) {
    throw ApiError.badRequest('WEAK_PASSWORD', 'Password must be at least 8 characters');
  }

  const inv = await UserInvitation.findOne({ __allowGlobal: true, token, acceptedAt: null });
  if (!inv) throw ApiError.badRequest('INVALID_INVITE', 'Invalid or expired invitation');
  if (inv.expiresAt < new Date()) throw ApiError.badRequest('INVITE_EXPIRED', 'Invitation expired');

  const user = await User.findOne({ __allowGlobal: true, _id: inv.userId });
  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');

  user.passwordHash = await hashPassword(password);
  if (fullName) user.fullName = fullName;
  user.status = 'active';
  user.mustChangePassword = false;
  await user.save();

  inv.acceptedAt = new Date();
  await inv.save();

  const tenant = await Tenant.findById(user.tenantId).lean();
  const payload = buildSessionPayload(user, tenant);

  return ok(res, {
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
    user: { id: user._id, email: user.email, role: user.role },
    tenant: {
      id: tenant._id,
      name: tenant.name,
      status: tenant.status,
      planCode: tenant.planCode,
    },
    scope: payload.scope,
  });
});

/* ─────────────── IMPERSONATE EXCHANGE ─────────────── */

const impersonateExchange = asyncHandler(async (req, res) => {
  const { impToken } = req.body;
  if (!impToken) throw ApiError.badRequest('MISSING_FIELDS', 'impToken required');

  let decoded;
  try {
    decoded = verifyAccessToken(impToken, 'tenant');
  } catch {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Invalid impersonation token');
  }

  if (!decoded.impersonatedBy) {
    throw ApiError.forbidden('NOT_IMPERSONATION', 'Not an impersonation token');
  }

  const user = await User.findOne({ __allowGlobal: true, _id: decoded.sub }).lean();
  if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User not found');

  const tenant = await Tenant.findById(user.tenantId).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const payload = {
    ...buildSessionPayload(user, tenant),
    impersonatedBy: decoded.impersonatedBy,
  };

  return ok(res, {
    accessToken: signAccessToken(payload, 'tenant'),
    refreshToken: signRefreshToken(payload, 'tenant').token,
    user: { id: user._id, email: user.email, role: user.role },
    tenant: {
      id: tenant._id,
      name: tenant.name,
      status: tenant.status,
      planCode: tenant.planCode,
    },
    scope: payload.scope,
    impersonatedBy: decoded.impersonatedBy,
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