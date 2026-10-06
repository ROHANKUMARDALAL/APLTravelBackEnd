'use strict';

const crypto = require('crypto');

/**
 * Shared scrypt password helpers (same algorithm as B2C auth).
 * Format: "<16-byte-hex-salt>:<32-byte-hex-hash>"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== next.length) return false;
  return crypto.timingSafeEqual(expected, next);
}

module.exports = { hashPassword, verifyPassword };
