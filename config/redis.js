const Redis = require('ioredis');
const { env } = require('./env');
const { logger } = require('../utils/logger');

let redis = null;
let redisSub = null;

async function connectRedis() {
  if (!env.redisEnabled) {
    logger.warn('redis disabled');
    return null;
  }

  if (redis) return redis;

  redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redisSub = redis.duplicate();

  redis.on('connect', () => logger.info('redis connected'));
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

function redisConnection() {
  if (!env.redisEnabled) return null;
  return { url: env.redisUrl, maxRetriesPerRequest: null };
}

module.exports = { connectRedis, disconnectRedis, getRedis, redisConnection };