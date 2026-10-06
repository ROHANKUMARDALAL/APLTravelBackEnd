'use strict';

const crypto = require('crypto');

/** SHA-256 hex digest of a raw opaque token. Never store the raw token. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issue a cryptographically random opaque token with a distinguishable prefix.
 * @param {string} prefix e.g. "apl_" or "dsa_"
 * @param {number} [bytes=24]
 */
function issueOpaqueToken(prefix, bytes = 24) {
  const safePrefix = String(prefix || '');
  return `${safePrefix}${crypto.randomBytes(bytes).toString('hex')}`;
}

module.exports = { hashToken, issueOpaqueToken };
