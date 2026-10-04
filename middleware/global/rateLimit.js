const { rateLimit } = require('express-rate-limit');
const { env } = require('../../config/env');
const { getRedis } = require('../../config/redis');

let store;

if (env.redisEnabled) {
  try {
    const RedisStore = require('rate-limit-redis').default || require('rate-limit-redis');
    const client = getRedis();
    if (client) {
      store = new RedisStore({
        sendCommand: (...args) => client.call(...args),
        prefix: 'rl:',
      });
    }
  } catch {
    store = undefined;
  }
}

const GROUP_LIMITS = {
  auth:     { windowMs: 15 * 60 * 1000, max: 20 },
  admin:    { windowMs: 15 * 60 * 1000, max: 600 },
  app:      { windowMs: 15 * 60 * 1000, max: 600 },
  public:   { windowMs: 15 * 60 * 1000, max: 200 },
  webhooks: { windowMs: 60 * 1000,      max: 200 },
  default:  { windowMs: 15 * 60 * 1000, max: 300 },
};

function resolveGroup(path) {
  if (path.startsWith('/api/auth'))            return 'auth';
  if (path.startsWith('/api/admin'))           return 'admin';
  if (path.startsWith('/api/app'))             return 'app';
  if (path.startsWith('/api/live/webhooks'))   return 'webhooks';
  if (path.startsWith('/api/public'))          return 'public';
  return 'default';
}

const rateLimitMw = rateLimit({
  windowMs: GROUP_LIMITS.default.windowMs,
  max: (req) => {
    const group = resolveGroup(req.originalUrl || req.url);
    return GROUP_LIMITS[group].max;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const group = resolveGroup(req.originalUrl || req.url);
    const id = req.headers['x-tenant-id'] || req.headers['x-admin-id'] || req.ip;
    return `${group}:${id}`;
  },
  store,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests' },
  },
});

module.exports = rateLimitMw;