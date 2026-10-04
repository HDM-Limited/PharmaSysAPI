const PlatformSetting = require('../models/admin/PlatformSetting');
const { logger } = require('../utils/logger');

const CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000;

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value) {
  CACHE.set(key, { value, at: Date.now() });
}

function cacheInvalidate(key) {
  if (key) CACHE.delete(key);
  else CACHE.clear();
}

async function get(key, fallback = null) {
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const value = await PlatformSetting.getValue(key, fallback);
  cacheSet(key, value);
  return value;
}

async function getMany(keys = []) {
  const out = {};
  await Promise.all(
    keys.map(async (k) => {
      out[k] = await get(k);
    })
  );
  return out;
}

async function set(key, value, adminId = null) {
  const doc = await PlatformSetting.setValue(key, value, adminId);
  cacheSet(key, value);
  return doc;
}

async function setMany(map = {}, adminId = null) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    await PlatformSetting.setValue(key, value, adminId);
    cacheSet(key, value);
    out[key] = value;
  }
  return out;
}

async function getBrand() {
  const keys = [
    'platform_name',
    'platform_logo_url',
    'support_email',
    'support_phone',
    'platform_whatsapp',
    'platform_website',
    'default_country',
  ];
  const values = await getMany(keys);

  return {
    name: values.platform_name || 'PharmaSys',
    logoUrl: values.platform_logo_url || null,
    supportEmail: values.support_email || '',
    supportPhone: values.support_phone || '',
    supportWhatsapp: values.platform_whatsapp || '',
    website: values.platform_website || '',
    country: values.default_country || 'KE',
  };
}

async function isRegistrationOpen() {
  return (await get('registration_open', true)) === true;
}

async function isMaintenanceMode() {
  return (await get('maintenance_mode', false)) === true;
}

async function getBackupConfig() {
  return getMany([
    'backup_enabled',
    'backup_auto_enabled',
    'backup_frequency',
    'backup_time',
    'backup_day_of_week',
    'backup_scope',
    'backup_collections',
    'backup_include_uploads',
    'backup_storage_target',
    'backup_encrypt',
    'backup_retention_days',
    'backup_notify_on_success',
    'backup_notify_on_fail',
    'backup_notify_emails',
    'backup_notify_roles',
    'backup_retry_on_failure',
    'backup_max_retries',
  ]);
}

async function getAiConfig() {
  return get('ai_config', {
    providers: [],
    defaultProvider: 'hdm',
    features: { landingAi: false, clientAi: true, fileUpload: false, outwardApiKeys: false },
  });
}

async function getMpesaConfig() {
  return get('mpesa_config', { stkCheckoutEnabled: false });
}

module.exports = {
  get,
  getMany,
  set,
  setMany,
  getBrand,
  isRegistrationOpen,
  isMaintenanceMode,
  getBackupConfig,
  getAiConfig,
  getMpesaConfig,
  cacheInvalidate,
};