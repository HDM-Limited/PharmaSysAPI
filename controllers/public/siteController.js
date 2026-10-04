const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const Plan = require('../../models/admin/Plan');
const Legal = require('../../models/admin/Legal');
const PlatformSetting = require('../../models/admin/PlatformSetting');
const hdmAi = require('../../config/hdmAi');

const PUBLIC_KEYS = [
  'platform_name',
  'platform_logo_url',
  'support_email',
  'support_phone',
  'platform_whatsapp',
  'platform_website',
  'default_currency',
  'default_country',
  'default_tax_rate',
  'registration_open',
  'business_types',
  'countries',
  'currencies',
  'chat_greeting',
  'chat_disclaimer',
  'ai_config',
];

const PUBLIC_DOWNLOAD_FIELDS = [
  'id',
  'name',
  'type',
  'version',
  'arch',
  'link',
  'size',
  'minOS',
  'releaseNotes',
];

async function settingsMap() {
  const docs = await PlatformSetting.find({ key: { $in: PUBLIC_KEYS } }).lean();
  return Object.fromEntries(docs.map((d) => [d.key, d.value]));
}

const brand = asyncHandler(async (_req, res) => {
  const s = await settingsMap();
  return ok(res, {
    name: s.platform_name || 'PharmaSys',
    logoUrl: s.platform_logo_url || '/brand/logo.svg',
    website: s.platform_website || null,
    supportEmail: s.support_email || null,
    supportPhone: s.support_phone || null,
    supportWhatsapp: s.platform_whatsapp || null,
  });
});

const settings = asyncHandler(async (_req, res) => {
  const s = await settingsMap();
  return ok(res, {
    defaultCurrency: s.default_currency || 'KES',
    defaultCountry: s.default_country || 'KE',
    defaultTaxRate: s.default_tax_rate ?? 16,
    registrationOpen: s.registration_open !== false,
    businessTypes: s.business_types || ['pharmacy'],
    countries: s.countries || [],
    currencies: s.currencies || ['KES'],
  });
});

const plans = asyncHandler(async (_req, res) => {
  const items = await Plan.find({ isPublic: true, isActive: true })
    .sort({ sortOrder: 1 })
    .select('code name description price limits features trialDays sortOrder')
    .lean();
  return ok(res, items);
});

const ai = asyncHandler(async (_req, res) => {
  const s = await settingsMap();
  const config = s.ai_config || {};
  const enabledProviders = (config.providers || [])
    .filter((p) => p.enabled)
    .map((p) => ({ key: p.key, label: p.label }));

  return ok(res, {
    landingAi: config.features?.landingAi === true,
    clientAi: config.features?.clientAi !== false,
    fileUpload: config.features?.fileUpload === true,
    providers: enabledProviders,
    defaultProvider: config.defaultProvider || 'hdm',
  });
});

const legal = asyncHandler(async (_req, res) => {
  const docs = await Legal.find({ isCurrent: true })
    .select('type title version effectiveAt')
    .lean();
  return ok(res, docs);
});

const legalByType = asyncHandler(async (req, res) => {
  const doc = await Legal.findOne({ type: req.params.type, isCurrent: true }).lean();
  if (!doc) throw ApiError.notFound('LEGAL_NOT_FOUND', 'Legal document not found');
  return ok(res, {
    type: doc.type,
    version: doc.version,
    title: doc.title,
    content: doc.content,
    effectiveAt: doc.effectiveAt,
  });
});

const downloads = asyncHandler(async (_req, res) => {
  const doc = await PlatformSetting.findOne({ key: 'downloads' }).lean();
  const all = Array.isArray(doc?.value) ? doc.value : [];

  const items = all
    .filter((d) => d.enabled !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((d) => {
      const out = {};
      for (const k of PUBLIC_DOWNLOAD_FIELDS) out[k] = d[k] ?? null;
      return out;
    });

  return ok(res, items);
});

const chat = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw ApiError.badRequest('MESSAGE_REQUIRED', 'message is required');
  }
  if (message.length > 1000) {
    throw ApiError.badRequest('MESSAGE_TOO_LONG', 'message must be under 1000 characters');
  }

  const s = await settingsMap();
  const config = s.ai_config || {};
  const greeting = s.chat_greeting || 'Hi! Ask me anything about PharmaSys.';
  const disclaimer =
    s.chat_disclaimer ||
    'PharmaSys AI gives business insights only, not medical advice.';

  if (config.features?.landingAi !== true || !hdmAi.enabled) {
    return ok(res, { reply: greeting, fallback: true });
  }

  const systemPrompt = [
    `You are ${s.platform_name || 'PharmaSys'} Assistant on the public website.`,
    `You help visitors understand ${s.platform_name || 'PharmaSys'} — a multi-tenant SaaS for pharmacies.`,
    disclaimer,
    'Reply in 1-3 short sentences. Never provide medical advice.',
  ].join('\n');

  try {
    const result = await hdmAi.complete({ message: message.trim(), systemPrompt });
    return ok(res, { reply: result.reply, fallback: false });
  } catch {
    return ok(res, { reply: greeting, fallback: true });
  }
});

module.exports = {
  brand,
  settings,
  plans,
  ai,
  legal,
  legalByType,
  downloads,
  chat,
};