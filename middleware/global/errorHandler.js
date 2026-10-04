const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');

function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL';
  let message = err.message || 'Internal server error';

  if (err.name === 'TokenExpiredError') {
    status = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
  } else if (err.name === 'JsonWebTokenError') {
    status = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
  } else if (err.name === 'NotBeforeError') {
    status = 401;
    code = 'TOKEN_NOT_ACTIVE';
    message = 'Token not active';
  } else if (err.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = message || 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid ${err.path || 'id'}`;
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    const field = Object.keys(err.keyPattern || {})[0];
    message = field ? `Duplicate value for ${field}` : 'Duplicate key';
  }

  if (status >= 500) {
    logger.error(
      { id: req.id, err: message, stack: err.stack, path: req.originalUrl },
      'server error'
    );
  }

  const body = {
    success: false,
    error: {
      code,
      message,
      requestId: req.id,
    },
  };

  if (err.details) body.error.details = err.details;

  if (env.nodeEnv !== 'production' && status >= 500 && err.stack) {
    body.error.stack = err.stack.split('\n');
  }

  res.status(status).json(body);
}

module.exports = errorHandler;