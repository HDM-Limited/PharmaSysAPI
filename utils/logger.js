const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'req.headers.authorization',
      'req.headers.cookie',
      'authorization',
      'cookie',
      'apiKey',
      'api_key',
      'secret',
      'token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[redacted]',
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: true,
          messageFormat: '{msg}',
          errorLikeObjectKeys: ['err', 'error'],
          errorProps: 'stack',
        },
      }
    : undefined,
});

module.exports = { logger };