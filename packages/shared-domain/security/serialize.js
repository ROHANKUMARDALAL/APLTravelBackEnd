'use strict';

const SENSITIVE_KEY_RE =
  /password|passwd|secret|credential|api[_-]?key|tokenHash|sessionHash|privateKey|clientSecret/i;

const SUPPLIER_SECRET_KEYS = new Set([
  'password',
  'apiKey',
  'api_key',
  'clientSecret',
  'client_secret',
  'credentialRefResolved',
  'secrets',
  'credentials',
]);

const CONFIDENTIAL_COMMERCIAL_KEYS = new Set([
  'supplierCost',
  'supplierPrice',
  'supplierAmount',
  'supplierNet',
  'aplMarkup',
  'aplMarkupAmount',
  'aplMargin',
  'internalMargin',
  'platformMargin',
  'commissionInternal',
  'supplierCommissionAmount',
]);

/**
 * Recursively omit keys matching secret patterns (password hashes, session hashes, etc.).
 */
function omitSensitiveKeys(value, { depth = 0 } = {}) {
  if (value == null || depth > 12) return value;
  if (Array.isArray(value)) {
    return value.map((v) => omitSensitiveKeys(v, { depth: depth + 1 }));
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k) || SUPPLIER_SECRET_KEYS.has(k)) continue;
    out[k] = omitSensitiveKeys(v, { depth: depth + 1 });
  }
  return out;
}

/**
 * Strip confidential APL commercial fields for DSAAdmin / public responses.
 * Shared schema ≠ shared API exposure.
 */
function stripConfidentialCommercial(value, { depth = 0 } = {}) {
  if (value == null || depth > 12) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripConfidentialCommercial(v, { depth: depth + 1 }));
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (CONFIDENTIAL_COMMERCIAL_KEYS.has(k)) continue;
    if (k === 'commercialSnapshot' && v && typeof v === 'object') {
      out[k] = stripConfidentialCommercial(v, { depth: depth + 1 });
      continue;
    }
    out[k] = stripConfidentialCommercial(v, { depth: depth + 1 });
  }
  return out;
}

/**
 * Public CMS / site config: keep only safe branding + content fields.
 * Callers should still project explicitly; this is a last-line filter.
 */
function publicCmsProjection(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const base = omitSensitiveKeys(doc);
  delete base.__v;
  return base;
}

module.exports = {
  omitSensitiveKeys,
  stripConfidentialCommercial,
  publicCmsProjection,
  CONFIDENTIAL_COMMERCIAL_KEYS,
  SUPPLIER_SECRET_KEYS,
};
