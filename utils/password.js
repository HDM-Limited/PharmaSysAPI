const bcrypt = require('bcrypt');
const { env } = require('../config/env');

async function hashPassword(plain) {
  if (!plain || typeof plain !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(plain, env.bcryptRounds);
}

async function comparePassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

function validatePasswordStrength(plain) {
  if (!plain || typeof plain !== 'string') return { ok: false, reason: 'EMPTY' };
  if (plain.length < 8) return { ok: false, reason: 'TOO_SHORT' };
  if (plain.length > 128) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true };
}

module.exports = { hashPassword, comparePassword, validatePasswordStrength };