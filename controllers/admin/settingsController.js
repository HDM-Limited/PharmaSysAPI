const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const PlatformSetting = require('../../models/admin/PlatformSetting');
const settingsService = require('../../services/settingsService');
const adminActionService = require('../../services/adminActionService');

const get = asyncHandler(async (_req, res) => {
  const docs = await PlatformSetting.find().lean();
  const map = Object.fromEntries(docs.map((d) => [d.key, d.value]));
  return ok(res, map);
});

const update = asyncHandler(async (req, res) => {
  const updates = req.body || {};
  const results = await settingsService.setMany(updates, req.admin.id);

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'settings.update',
    metadata: { keys: Object.keys(updates) },
    ip: req.ip,
  });

  return ok(res, results);
});

const updateFeatures = asyncHandler(async (req, res) => {
  const updates = req.body || {};
  const features = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k.startsWith('feature_')) features[k] = Boolean(v);
  }
  const results = await settingsService.setMany(features, req.admin.id);

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'settings.update_features',
    metadata: { keys: Object.keys(features) },
    ip: req.ip,
  });

  return ok(res, results);
});

const getAi = asyncHandler(async (_req, res) => {
  const config = await settingsService.getAiConfig();
  return ok(res, config);
});

const updateAi = asyncHandler(async (req, res) => {
  const current = await settingsService.getAiConfig();
  const incoming = req.body || {};

  const merged = {
    providers: incoming.providers || current.providers,
    defaultProvider: incoming.defaultProvider || current.defaultProvider,
    features: { ...current.features, ...(incoming.features || {}) },
  };

  await settingsService.set('ai_config', merged, req.admin.id);

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'settings.update_ai',
    ip: req.ip,
  });

  return ok(res, merged);
});

const testAiProvider = asyncHandler(async (req, res) => {
  const config = await settingsService.getAiConfig();
  const provider = (config.providers || []).find((p) => p.key === req.params.key);
  if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' } });
  if (!provider.apiKey) return res.status(400).json({ success: false, error: { code: 'NO_KEY', message: 'No API key configured' } });
  return ok(res, { key: provider.key, enabled: provider.enabled, hasKey: true });
});

const getMpesa = asyncHandler(async (_req, res) => {
  const config = await settingsService.getMpesaConfig();
  return ok(res, config);
});

const updateMpesa = asyncHandler(async (req, res) => {
  const current = await settingsService.getMpesaConfig();
  const next = {
    stkCheckoutEnabled:
      typeof req.body?.stkCheckoutEnabled === 'boolean'
        ? req.body.stkCheckoutEnabled
        : current.stkCheckoutEnabled,
  };

  await settingsService.set('mpesa_config', next, req.admin.id);

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'settings.update_mpesa',
    ip: req.ip,
  });

  return ok(res, next);
});

const getPublic = asyncHandler(async (_req, res) => {
  const keys = [
    'platform_name', 'platform_logo_url', 'support_email', 'support_phone',
    'platform_whatsapp', 'platform_website', 'default_currency', 'default_country',
    'default_tax_rate', 'business_types', 'countries', 'currencies', 'registration_open',
  ];
  const docs = await PlatformSetting.find({ key: { $in: keys } }).lean();
  const map = Object.fromEntries(docs.map((d) => [d.key, d.value]));
  return ok(res, map);
});

module.exports = { get, update, updateFeatures, getAi, updateAi, testAiProvider, getMpesa, updateMpesa, getPublic };