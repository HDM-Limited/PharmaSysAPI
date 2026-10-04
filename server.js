require('./scripts/dnsSet');
require('dotenv/config');

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { rateLimit } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const pkg = require('./package.json');
const { env } = require('./config/env');
const { connectDB, disconnectDB, mongoose } = require('./config/db');
const { connectRedis, disconnectRedis, getRedis } = require('./config/redis');
const { logger } = require('./utils/logger');

const requestId = require('./middleware/global/requestId');
const requestLogger = require('./middleware/global/requestLogger');
const notFound = require('./middleware/global/notFound');
const errorHandler = require('./middleware/global/errorHandler');

const routes = require('./routes');
const { startSchedulers, stopSchedulers } = require('./schedulers');

/* ─────────────── crash throttle ─────────────── */

const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 5;
const crashTimes = [];

function recordCrash() {
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > CRASH_WINDOW_MS) crashTimes.shift();
  return crashTimes.length;
}

/* ─────────────── main ─────────────── */

async function bootstrap() {
  logger.info(`PharmaSys API v${pkg.version} starting — env=${env.nodeEnv} port=${env.port}`);

  try {
    await connectDB();
  } catch (e) {
    logger.error({ err: e.message }, 'boot failed: mongodb — retrying in 5s');
    setTimeout(bootstrap, 5000);
    return;
  }

  if (env.redisEnabled) {
    try {
      await connectRedis();
    } catch (e) {
      logger.warn({ err: e.message }, 'boot: redis failed — continuing');
    }
  }

  const app = express();
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(requestLogger);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  const corsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));

  /* ─── body parsers ─── */
  // Webhook-specific (must run BEFORE the global json parser)
  app.use('/api/live/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use('/api/live/webhooks/mpesa', express.json({ limit: '1mb' }));
  app.use('/api/live/webhooks/mpesa/timeout', express.json({ limit: '1mb' }));

  // Global parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(mongoSanitize({ replaceWith: '_', allowDots: false }));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    },
  }));

  /* ─── static brand assets ─── */
  app.use('/brand', express.static('public/brand'));

  /* ─── informational routes ─── */
  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      service: 'pharmasys-api',
      version: pkg.version,
      message: 'PharmaSys API — running',
      env: env.nodeEnv,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api', (_req, res) => {
    res.json({
      ok: true,
      service: 'pharmasys-api',
      version: pkg.version,
      message: 'PharmaSys API — /api',
      endpoints: {
        health: '/health',
        public: '/api/public',
        auth: '/api/auth',
        app: '/api/app',
        admin: '/api/admin',
        live: '/api/live',
      },
    });
  });

  app.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    const redis = getRedis();
    const redisUp = redis ? redis.status === 'ready' : false;

    res.json({
      ok: true,
      status: dbUp ? 'healthy' : 'degraded',
      service: 'pharmasys-api',
      version: pkg.version,
      env: env.nodeEnv,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      deps: {
        mongodb: dbUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      },
    });
  });

  /* ─── API routes ─── */
  app.use('/api', routes);

  /* ─── terminal middleware ─── */
  app.use(notFound);
  app.use(errorHandler);

  /* ─── HTTP + Socket.IO ─── */
  const server = http.createServer(app);

  const io = new Server(server, {
    path: '/api/live/ws',
    cors: { origin: env.corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('NO_TOKEN'));
      const payload = jwt.verify(token, env.jwt.accessSecret);
      socket.data.userId = payload.sub;
      socket.data.tenantId = payload.tenantId;
      socket.data.role = payload.role;
      socket.data.branchIds = payload.branchIds || [];
      socket.data.scope = payload.scope;
      return next();
    } catch {
      return next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, userId, branchIds, role } = socket.data;
    if (tenantId) socket.join(`tenant:${tenantId}`);
    if (userId) socket.join(`user:${userId}`);
    if (role !== 'owner' && branchIds?.length) socket.join(`branch:${branchIds[0]}`);
    logger.info(`socket connected user=${userId} tenant=${tenantId} role=${role}`);
  });

  global.__io = io;

  server.listen(env.port, () => {
    logger.info(`listening on ${env.apiUrl}`);
    logger.info(`health  ${env.apiUrl}/health`);
    logger.info(`api     ${env.apiUrl}/api`);
    logger.info(`socket  ${env.apiUrl}/api/live/ws`);
  });

  try {
    startSchedulers();
  } catch (e) {
    logger.error({ err: e.message }, 'schedulers failed to start — server continues');
  }

  /* ─── shutdown ─── */
  const shutdown = async (signal) => {
    logger.warn(`shutdown: ${signal}`);
    server.close(async () => {
      try {
        await stopSchedulers();
        await io.close();
        await disconnectRedis();
        await disconnectDB();
        logger.info('shutdown complete');
        process.exit(0);
      } catch (e) {
        logger.error({ err: e.message }, 'shutdown error');
        process.exit(1);
      }
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGUSR2', () => shutdown('SIGUSR2'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandledRejection — continuing');
    const count = recordCrash();
    if (count >= CRASH_LIMIT) {
      logger.fatal(`crash throttle hit (${count}/${CRASH_LIMIT} in ${CRASH_WINDOW_MS / 1000}s) — exiting`);
      process.exit(1);
    }
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err: err.message, stack: err.stack }, 'uncaughtException — continuing');
    const count = recordCrash();
    if (count >= CRASH_LIMIT) {
      logger.fatal(`crash throttle hit (${count}/${CRASH_LIMIT} in ${CRASH_WINDOW_MS / 1000}s) — exiting`);
      process.exit(1);
    }
  });
}

bootstrap();