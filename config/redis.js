const Redis = require('ioredis');
const { env } = require('./env');
const { logger } = require('../utils/logger');

let redis = null;
let redisSub = null;

function buildOptions() {
  const url = env.redisUrl;
  const isTls = url.startsWith('rediss://');
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    ...(isTls ? { tls: {} } : {}),
  };
}

async function connectRedis() {
  if (!env.redisEnabled) {
    logger.warn('redis disabled');
    return null;
  }
  if (redis) return redis;

  redis = new Redis(env.redisUrl, buildOptions());
  redisSub = redis.duplicate();

  redis.on('connect', () => logger.info('redis connected'));
  redis.on('ready', () => logger.info('redis ready'));
  redis.on('error', (e) => logger.error({ err: e.message }, 'redis error'));

  return redis;
}

async function disconnectRedis() {
  if (redis) await redis.quit().catch(() => {});
  if (redisSub) await redisSub.quit().catch(() => {});
  redis = null;
  redisSub = null;
}

function getRedis() {
  return redis;
}

function bullConnection() {
  if (!env.redisEnabled || !redis) return null;
  return redis;
}

module.exports = {
  connectRedis,
  disconnectRedis,
  getRedis,
  bullConnection,
};