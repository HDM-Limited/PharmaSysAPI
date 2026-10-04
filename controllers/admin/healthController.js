const os = require('os');
const mongoose = require('mongoose');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { env } = require('../../config/env');
const { getRedis } = require('../../config/redis');

const Backup = require('../../models/admin/Backup');
const PlatformSetting = require('../../models/admin/PlatformSetting');

function maskMongoHost(uri) {
  try {
    const u = new URL(uri);
    return u.host;
  } catch {
    return 'unknown';
  }
}

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = String(email).split('@');
  if (!domain) return '[redacted]';
  return `${user.slice(0, 2)}***@${domain}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h) parts.push(`${s}s`);
  return parts.join(' ');
}

async function collectServer() {
  const mem = process.memoryUsage();
  const pkg = require('../../package.json');

  return {
    status: 'up',
    version: pkg.version,
    node: process.version,
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    url: env.apiUrl || null,
    uptimeSeconds: Math.floor(process.uptime()),
    uptimeHuman: formatUptime(process.uptime()),
    cpuCores: os.cpus().length,
    memoryRssMb: Math.round(mem.rss / 1024 / 1024),
    memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    pid: process.pid,
  };
}

async function collectDatabase() {
  const db = mongoose.connection.db;
  const stateMap = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const status = stateMap[mongoose.connection.readyState] || 'unknown';

  let collections = 0;
  let documents = 0;
  let dbName = null;

  if (db && mongoose.connection.readyState === 1) {
    try {
      const cols = await db.listCollections().toArray();
      collections = cols.length;
      dbName = db.databaseName;

      for (const c of cols) {
        try {
          documents += await db.collection(c.name).estimatedDocumentCount();
        } catch {}
      }
    } catch {}
  }

  return {
    status,
    type: 'MongoDB',
    host: maskMongoHost(env.mongoUri),
    database: dbName,
    collections,
    documents,
  };
}

async function collectRedis() {
  const redis = getRedis();

  if (!env.redisEnabled) {
    return {
      status: 'disabled',
      enabled: false,
      host: env.redisUrl,
      message: 'Redis disabled via REDIS_ENABLED=false',
    };
  }

  if (!redis) {
    return {
      status: 'down',
      enabled: true,
      host: env.redisUrl,
    };
  }

  try {
    const pong = await redis.ping();
    const info = await redis.info('memory').catch(() => '');
    const used = info.match(/used_memory_human:([^\r\n]+)/);

    return {
      status: pong === 'PONG' ? 'up' : 'down',
      enabled: true,
      host: env.redisUrl,
      memoryUsed: used ? used[1].trim() : null,
    };
  } catch (e) {
    return {
      status: 'down',
      enabled: true,
      host: env.redisUrl,
      error: e.message,
    };
  }
}

async function collectEmail() {
  const enabled = Boolean(env.hdm.apiKey && env.hdm.fromEmail);
  return {
    status: enabled ? 'enabled' : 'disabled',
    enabled,
    provider: 'HDM Bridge',
    from: env.hdm.fromEmail || null,
    fromMasked: maskEmail(env.hdm.fromEmail),
    sender: env.hdm.fromName || null,
  };
}

async function collectSms() {
  const enabled = Boolean(env.hdm.apiKey && env.hdm.smsSender);
  return {
    status: enabled ? 'enabled' : 'disabled',
    enabled,
    provider: 'HDM Bridge',
    sender: env.hdm.smsSender || null,
  };
}

async function collectAi() {
  const enabled = Boolean(env.hdmAi.key && env.hdmAi.url);
  return {
    status: enabled ? 'enabled' : 'disabled',
    enabled,
    provider: 'HDM AI',
    baseUrl: env.hdmAi.url || null,
  };
}

async function collectMpesa() {
  const enabled = Boolean(
    env.mpesa.consumerKey &&
    env.mpesa.consumerSecret &&
    env.mpesa.shortcode &&
    env.mpesa.passkey
  );
  return {
    status: enabled ? 'enabled' : 'disabled',
    enabled,
    mode: env.mpesa.env,
    transactionType: env.mpesa.transactionType,
  };
}

async function collectStripe() {
  const enabled = Boolean(env.stripe.secret);
  return {
    status: enabled ? 'enabled' : 'disabled',
    enabled,
  };
}

async function collectStorage() {
  const enabled = Boolean(
    env.cloudinary.cloudName &&
    env.cloudinary.apiKey &&
    env.cloudinary.apiSecret
  );
  return {
    status: enabled ? 'enabled' : 'disabled',
    enabled,
    type: 'Cloudinary',
    cloud: env.cloudinary.cloudName || null,
  };
}

async function collectBackups() {
  const [total, lastSuccess] = await Promise.all([
    Backup.countDocuments({ status: 'success' }),
    Backup.findOne({ status: 'success' }).sort({ completedAt: -1 }).lean(),
  ]);

  return {
    status: 'enabled',
    type: 'Cloudinary',
    folder: 'pharmasys/backups',
    count: total,
    lastBackupAt: lastSuccess?.completedAt || null,
    lastBackupSize: lastSuccess?.sizeBytes || null,
  };
}

async function collectSettings() {
  const keys = ['platform_name', 'platform_logo_url', 'support_email', 'support_phone'];
  const docs = await PlatformSetting.find({ key: { $in: keys } }).lean();
  const m = Object.fromEntries(docs.map((d) => [d.key, d.value]));

  return {
    platformName: m.platform_name || 'PharmaSys',
    logoUrl: m.platform_logo_url || null,
    supportEmail: m.support_email || null,
    supportPhone: m.support_phone || null,
  };
}

function collectCors() {
  return env.corsOrigins;
}

function computeOverall(sections) {
  const keys = ['server', 'database', 'redis', 'email', 'sms', 'ai', 'mpesa', 'stripe', 'storage'];
  let up = 0;
  for (const k of keys) {
    const s = sections[k]?.status;
    if (['up', 'enabled', 'connected', 'disabled'].includes(s)) up++;
  }
  return { up, total: keys.length };
}

const health = asyncHandler(async (_req, res) => {
  const [server, database, redis, email, sms, ai, mpesa, stripe, storage, backups, settings] = await Promise.all([
    collectServer(),
    collectDatabase(),
    collectRedis(),
    collectEmail(),
    collectSms(),
    collectAi(),
    collectMpesa(),
    collectStripe(),
    collectStorage(),
    collectBackups(),
    collectSettings(),
  ]);

  const sections = { server, database, redis, email, sms, ai, mpesa, stripe, storage };
  const overall = computeOverall(sections);

  return ok(res, {
    status: overall.up === overall.total ? 'healthy' : overall.up > 1 ? 'degraded' : 'unhealthy',
    overall,
    timestamp: new Date().toISOString(),
    platform: settings,
    server,
    database,
    redis,
    email,
    sms,
    ai,
    mpesa,
    stripe,
    storage,
    backups,
    cors: collectCors(),
  });
});

const ready = asyncHandler(async (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  if (!dbUp) {
    return res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Database unavailable' },
    });
  }
  return ok(res, { ready: true });
});

const metrics = asyncHandler(async (_req, res) => {
  const mem = process.memoryUsage();
  return ok(res, {
    uptimeSeconds: Math.floor(process.uptime()),
    uptimeHuman: formatUptime(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    cpu: {
      cores: os.cpus().length,
      loadAvg: os.loadavg(),
      model: os.cpus()[0]?.model || null,
    },
    node: process.version,
    platform: `${os.type()} ${os.release()}`,
    pid: process.pid,
  });
});

module.exports = { health, ready, metrics };