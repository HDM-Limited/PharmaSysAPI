const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { env } = require('../config/env');

function signAccessToken(payload, kind = 'tenant') {
  const secret = kind === 'admin' ? env.adminJwt.accessSecret : env.jwt.accessSecret;
  const expiresIn = kind === 'admin' ? env.adminJwt.accessTtl : env.jwt.accessTtl;
  return jwt.sign(payload, secret, { expiresIn });
}

function signRefreshToken(payload, kind = 'tenant') {
  const secret = kind === 'admin' ? env.adminJwt.refreshSecret : env.jwt.refreshSecret;
  const expiresIn = kind === 'admin' ? env.adminJwt.refreshTtl : env.jwt.refreshTtl;
  const jti = crypto.randomBytes(16).toString('hex');
  const token = jwt.sign({ ...payload, jti }, secret, { expiresIn });
  return { token, jti };
}

function verifyAccessToken(token, kind = 'tenant') {
  const secret = kind === 'admin' ? env.adminJwt.accessSecret : env.jwt.accessSecret;
  return jwt.verify(token, secret);
}

function verifyRefreshToken(token, kind = 'tenant') {
  const secret = kind === 'admin' ? env.adminJwt.refreshSecret : env.jwt.refreshSecret;
  return jwt.verify(token, secret);
}

function decode(token) {
  return jwt.decode(token);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decode,
};