const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const Tenant = require('../../models/admin/Tenant');
const { signedUploadParams } = require('../../config/cloudinary');

const get = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select('settings name').lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const defaults = {
    currency: 'KES',
    taxRate: 16,
    taxInclusive: false,
    receiptHeader: null,
    receiptFooter: null,
    logoPublicId: null,
    logoUrl: null,
    aiEnabled: true,
    smsEnabled: true,
  };

  return ok(res, { name: tenant.name, ...defaults, ...(tenant.settings || {}) });
});

const update = asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can edit settings');
  }

  const allowed = [
    'currency', 'taxRate', 'taxInclusive', 'receiptHeader', 'receiptFooter',
    'logoPublicId', 'logoUrl', 'aiEnabled', 'smsEnabled',
  ];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const tenant = await Tenant.findById(req.tenantId).select('settings name');
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  tenant.settings = { ...(tenant.settings || {}), ...patch };
  await tenant.save();

  return ok(res, { name: tenant.name, ...tenant.settings });
});

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

module.exports = { get, update, signUpload };