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
  'api_key',
  'apisecret',
  'api_secret',
  'secret',
  'clientsecret',
  'client_secret',
  'accesskey',
  'access_key',
  'secretkey',
  'secret_key',
  'bearer',
  'authtoken',
  'auth_token',
  'supplierpassword',
  'supplier_password',
  'credential',
  'credentials',
  'privatekey',
  'private_key',
]);

const SECRET_SUBSTRINGS = [
  'password',
  'secret',
  'apikey',
  'api_key',
  'token',
  'cvv',
  'authorization',
];

function isSecretKey(key) {
  const lower = String(key || '').toLowerCase();
  if (SECRET_KEYS.has(lower)) return true;
  return SECRET_SUBSTRINGS.some((part) => lower.includes(part));
}

/**
 * Deep-redact sensitive fields before persistence or audit.
 */
function redact(value, depth = 0) {
  if (value == null || depth > 10) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(child, depth + 1);
    }
  }
  return out;
}

module.exports = { redact, isSecretKey, SECRET_KEYS };
