const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const Tenant = require('../../models/admin/Tenant');
const { signedUploadParams } = require('../../config/cloudinary');

/* ═════════════════════════════════════════════════════════════════
   GET — current tenant settings
   ═════════════════════════════════════════════════════════════════ */

const get = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select('settings name').lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const defaults = {
    currency: 'KES',
    taxRate: 16,
    taxInclusive: false,
    address: null,
    receiptHeader: null,
    receiptFooter: null,
    logoPublicId: null,
    logoUrl: null,
    aiEnabled: true,
    smsEnabled: true,
  };

  return ok(res, { name: tenant.name, ...defaults, ...(tenant.settings || {}) });
});

/* ═════════════════════════════════════════════════════════════════
   UPDATE — patch tenant settings + business name (owner only)
   ═════════════════════════════════════════════════════════════════ */

const update = asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can edit settings');
  }

  const allowed = [
    'currency',
    'taxRate',
    'taxInclusive',
    'address',
    'receiptHeader',
    'receiptFooter',
    'logoPublicId',
    'logoUrl',
    'aiEnabled',
    'smsEnabled',
  ];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const tenant = await Tenant.findById(req.tenantId).select('settings name');
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  /* Business name lives on Tenant, not Tenant.settings */
  if (req.body.name !== undefined) {
    const trimmed = String(req.body.name).trim();
    if (!trimmed) {
      throw ApiError.badRequest('INVALID_NAME', 'Business name cannot be empty');
    }
    if (trimmed.length > 120) {
      throw ApiError.badRequest('NAME_TOO_LONG', 'Business name must be under 120 characters');
    }
    tenant.name = trimmed;
  }

  tenant.settings = { ...(tenant.settings || {}), ...patch };
  await tenant.save();

  return ok(res, { name: tenant.name, ...tenant.settings });
});

/* ═════════════════════════════════════════════════════════════════
   SIGN UPLOAD — Cloudinary signature for client-side uploads
   ═════════════════════════════════════════════════════════════════ */

const signUpload = asyncHandler(async (req, res) => {
  const { folder = 'general', publicId } = req.body;
  const allowed = ['logo', 'receipts', 'drugs', 'exports', 'imports'];
  if (!allowed.includes(folder)) {
    throw ApiError.badRequest('INVALID_FOLDER', 'Invalid upload folder');
  }

  const safeFolder = `pharmasys/tenants/${req.tenantId}/${folder}`;
  const params = signedUploadParams({
    folder: safeFolder,
    publicId: publicId || undefined,
    resourceType: 'auto',
  });

  return ok(res, params);
});

/* ═════════════════════════════════════════════════════════════════
   EXPORTS
   ═════════════════════════════════════════════════════════════════ */

const exported = { get, update, signUpload };

for (const [name, fn] of Object.entries(exported)) {
  if (typeof fn !== 'function') {
    throw new Error(`settingsController: export "${name}" is not a function`);
  }
}

module.exports = exported;