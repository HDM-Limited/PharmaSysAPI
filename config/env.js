require('dotenv/config');

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function optional(key, fallback = null) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function bool(key, fallback = false) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function int(key, fallback = 0) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function list(key, fallback = []) {
  const value = process.env[key];
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: int('PORT', 5000),
  appUrl: optional('APP_URL', 'http://localhost:3000'),
  adminUrl: optional('ADMIN_URL', 'http://localhost:3001'),
  apiUrl: optional('API_URL', 'http://localhost:5000'),
  logLevel: optional('LOG_LEVEL', 'debug'),

  mongoUri: required('MONGODB_URI'),

  redisEnabled: bool('REDIS_ENABLED', true),
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: optional('JWT_ACCESS_TTL', '15m'),
    refreshTtl: optional('JWT_REFRESH_TTL', '7d'),
  },

  adminJwt: {
    accessSecret: required('ADMIN_JWT_ACCESS_SECRET'),
    refreshSecret: required('ADMIN_JWT_REFRESH_SECRET'),
    accessTtl: optional('ADMIN_JWT_ACCESS_TTL', '15m'),
    refreshTtl: optional('ADMIN_JWT_REFRESH_TTL', '7d'),
  },

  bcryptRounds: int('BCRYPT_ROUNDS', 12),

  corsOrigins: list('CORS_ORIGINS', ['http://localhost:3000', 'http://localhost:3001']),

  hdm: {
    apiKey: optional('HDM_API_KEY', ''),
    apiUrl: optional('HDM_API_URL', 'https://bridgeapi.hdm.co.ke/api'),
    fromEmail: optional('HDM_FROM_EMAIL', ''),
    fromName: optional('HDM_FROM_NAME', 'PharmaSys'),
    smsSender: optional('HDM_SMS_SENDER', 'PHARMASYS'),
  },

  hdmAi: {
    key: optional('HDM_AI_KEY', ''),
    url: optional('HDM_AI_URL', 'https://hdmaiserver.pxxl.click/api/v1'),
  },

  mpesa: {
    env: optional('MPESA_ENV', 'production'),
    baseUrl: optional('MPESA_BASE_URL', 'https://api.safaricom.co.ke'),
    consumerKey: optional('MPESA_CONSUMER_KEY', ''),
    consumerSecret: optional('MPESA_CONSUMER_SECRET', ''),
    shortcode: optional('MPESA_SHORTCODE', ''),
    tillNumber: optional('MPESA_TILL_NUMBER', ''),
    passkey: optional('MPESA_PASSKEY', ''),
    callbackUrl: optional('MPESA_CALLBACK_URL', ''),
    transactionType: optional('MPESA_TRANSACTION_TYPE', 'CustomerBuyGoodsOnline'),
  },

  stripe: {
    secret: optional('STRIPE_SECRET', ''),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET', ''),
    priceBasic: optional('STRIPE_PRICE_BASIC', ''),
    pricePro: optional('STRIPE_PRICE_PRO', ''),
    priceEnterprise: optional('STRIPE_PRICE_ENTERPRISE', ''),
  },

  cloudinary: {
    cloudName: optional('CLOUDINARY_CLOUD_NAME', ''),
    apiKey: optional('CLOUDINARY_API_KEY', ''),
    apiSecret: optional('CLOUDINARY_API_SECRET', ''),
    uploadPreset: optional('CLOUDINARY_UPLOAD_PRESET', 'pharmasys_signed'),
  },
};

module.exports = { env };