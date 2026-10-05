const cors = require('cors');
const { env } = require('../../config/env');

const corsMw = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (env.corsOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Branch-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86400,
});

module.exports = corsMw;