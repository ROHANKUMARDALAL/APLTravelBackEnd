'use strict';

const crypto = require('crypto');

const DEV_FALLBACK = 'apl-dev-field-key-not-for-production';

function fieldKey() {
  const raw = String(process.env.APL_FIELD_KEY || '').trim();
  if (raw.length >= 16) return crypto.createHash('sha256').update(raw).digest();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APL_FIELD_KEY is required before identity documents can be stored');
  }
  return crypto.createHash('sha256').update(DEV_FALLBACK).digest();
}

function encryptField(plain) {
  const value = String(plain || '').trim();
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fieldKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

function decryptField(stored) {
  const value = String(stored || '');
  if (!value) return '';
  if (!value.startsWith('enc:v1:')) return '';
  const [, , ivB64, tagB64, dataB64] = value.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    fieldKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

function maskDocument(plain) {
  const value = String(plain || '').replace(/\s+/g, '');
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

module.exports = {
  encryptField,
  decryptField,
  maskDocument,
};
