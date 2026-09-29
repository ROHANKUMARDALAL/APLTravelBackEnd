'use strict';

const SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'cardnumber',
  'cvv',
  'cvc',
  'logintoken',
  'token',
  'authorization',
  'captchaanswer',
  'apikey',
  'secret',
]);

function redact(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(child, depth + 1);
    }
  }
  return out;
}

module.exports = { redact };
