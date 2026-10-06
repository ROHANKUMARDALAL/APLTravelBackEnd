'use strict';

/**
 * Secure supplier credential resolver (Phase 11A).
 *
 * Source of truth for secret values: process.env / deployment secret store.
 * Mongo Supplier documents hold only credentialRef + credentialsConfigured metadata.
 *
 * Convention for credentialRef = "SUPPLIER_TBO" and environment = "TEST":
 *   SUPPLIER_TBO_TEST_BASE_URL | SUPPLIER_TBO_TEST_API_URL
 *   SUPPLIER_TBO_TEST_USERNAME
 *   SUPPLIER_TBO_TEST_PASSWORD
 *   SUPPLIER_TBO_TEST_API_KEY
 *   SUPPLIER_TBO_TEST_CLIENT_ID
 *   SUPPLIER_TBO_TEST_CLIENT_SECRET
 *
 * Also accepts unscoped TEST aliases when env is TEST:
 *   SUPPLIER_TBO_BASE_URL, SUPPLIER_TBO_USERNAME, …
 *
 * Legacy placeholders (existing .env.example) as fallback for known codes:
 *   TBO_API_URL / TBO_USERNAME / TBO_PASSWORD
 *
 * Never returns secrets via publicSupplier / APLAdmin APIs.
 */

const { config } = require('../../common/config');
const {
  SupplierErrorCode,
  SupplierRuntimeError,
} = require('./errors');

const SECRET_KEYS = [
  'username',
  'password',
  'apiKey',
  'clientId',
  'clientSecret',
];

function envFirst(...names) {
  for (const name of names) {
    if (!name) continue;
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function legacyBundle(supplierCode) {
  const code = String(supplierCode || '').toUpperCase();
  const key = code.toLowerCase();
  const bundle = config.suppliers?.[key];
  if (!bundle) return null;
  return {
    baseUrl: bundle.apiUrl || '',
    username: bundle.username || '',
    password: bundle.password || '',
    apiKey: '',
    clientId: '',
    clientSecret: '',
  };
}

/**
 * Resolve runtime credentials for a supplier catalog row / plan entry.
 * Secrets stay in-memory for the adapter call only.
 */
function resolveSupplierCredentials({
  credentialRef,
  environment = 'TEST',
  supplierCode,
  requireConfigured = false,
} = {}) {
  const env = String(environment || 'TEST').toUpperCase();
  const ref = String(credentialRef || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '');
  const code = String(supplierCode || '')
    .trim()
    .toUpperCase();

  const prefixes = [];
  if (ref) {
    prefixes.push(`${ref}_${env}`);
    if (env === 'TEST') prefixes.push(ref);
  }
  if (code && (!ref || ref !== `SUPPLIER_${code}`)) {
    prefixes.push(`SUPPLIER_${code}_${env}`);
    if (env === 'TEST') prefixes.push(`SUPPLIER_${code}`);
  }

  const pick = (suffixes) => {
    const names = [];
    for (const prefix of prefixes) {
      for (const suffix of suffixes) {
        names.push(`${prefix}_${suffix}`);
      }
    }
    return envFirst(...names);
  };

  let resolved = {
    supplierCode: code || undefined,
    credentialRef: ref || undefined,
    environment: env,
    baseUrl: pick(['BASE_URL', 'API_URL']),
    username: pick(['USERNAME', 'USER']),
    password: pick(['PASSWORD', 'PASS']),
    apiKey: pick(['API_KEY', 'APIKEY', 'KEY']),
    clientId: pick(['CLIENT_ID', 'CLIENTID']),
    clientSecret: pick(['CLIENT_SECRET', 'CLIENTSECRET']),
  };

  const legacy = legacyBundle(code);
  if (legacy) {
    resolved = {
      ...resolved,
      baseUrl: resolved.baseUrl || legacy.baseUrl,
      username: resolved.username || legacy.username,
      password: resolved.password || legacy.password,
    };
  }

  const hasSecret = SECRET_KEYS.some((k) => Boolean(resolved[k]));
  const configured = Boolean(resolved.baseUrl) && hasSecret;
  const missing = [];
  if (!resolved.baseUrl) missing.push('baseUrl');
  if (!hasSecret) missing.push('auth');

  const result = {
    configured,
    missing,
    environment: env,
    credentialRef: ref || null,
    supplierCode: code || null,
    /** Opaque for adapters — never serialize into ServiceLog intentionally. */
    secrets: {
      baseUrl: resolved.baseUrl,
      username: resolved.username,
      password: resolved.password,
      apiKey: resolved.apiKey,
      clientId: resolved.clientId,
      clientSecret: resolved.clientSecret,
    },
    /** Safe metadata only (no secret values). */
    meta: {
      environment: env,
      credentialRef: ref || null,
      supplierCode: code || null,
      configured,
      missing,
      hasBaseUrl: Boolean(resolved.baseUrl),
      hasUsername: Boolean(resolved.username),
      hasPassword: Boolean(resolved.password),
      hasApiKey: Boolean(resolved.apiKey),
      hasClientId: Boolean(resolved.clientId),
      hasClientSecret: Boolean(resolved.clientSecret),
    },
  };

  if (requireConfigured && !configured) {
    throw new SupplierRuntimeError(
      SupplierErrorCode.CREDENTIALS_MISSING,
      `Supplier credentials not configured for ${code || ref || 'UNKNOWN'} (${env})`,
      { missing: result.missing, credentialRef: ref || null, environment: env },
    );
  }

  return result;
}

/** Public-safe view — never includes secret values. */
function credentialMetaPublic(resolved) {
  if (!resolved) {
    return { configured: false };
  }
  return { ...resolved.meta };
}

module.exports = {
  resolveSupplierCredentials,
  credentialMetaPublic,
};
