'use strict';

const crypto = require('crypto');

function deriveKey(secret) {
  const raw = String(secret || '');
  if (!raw) {
    throw new Error('GATEWAY_CREDENTIAL_KEY is required before supplier secrets can be stored.');
  }
  const decoded = /^[A-Za-z0-9+/=]+$/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (decoded.length === 32) return decoded;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptJson(value, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    keyVersion: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptJson(payload, secret) {
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { deriveKey, encryptJson, decryptJson };
