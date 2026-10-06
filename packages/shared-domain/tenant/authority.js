'use strict';

const { CLIENT_TENANT_KEYS, CLIENT_TENANT_HEADERS } = require('../constants/tenant');

/**
 * Trusted tenant identity contract (Phase 15C spoof protection):
 *
 * PUBLIC B2C: Host → DSA resolver → req.tenant.dsaId
 * DSAADMIN:   Session → DsaAdminUser.dsaId → req.tenant.dsaId
 * APLADMIN:   Platform session; target DSA only on authorized platform routes
 *
 * Never trust body.dsaId / query.dsaId / X-DSA-ID for tenant authority.
 */

function isClientTenantKey(key) {
  return CLIENT_TENANT_KEYS.includes(String(key || ''));
}

function isClientTenantHeader(name) {
  return CLIENT_TENANT_HEADERS.includes(String(name || '').toLowerCase());
}

/**
 * Strip client-supplied tenant selectors from a plain object (shallow).
 * Does not mutate the original.
 */
function stripClientTenantSelectors(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out = { ...input };
  for (const key of CLIENT_TENANT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(out, key)) delete out[key];
  }
  return out;
}

module.exports = {
  isClientTenantKey,
  isClientTenantHeader,
  stripClientTenantSelectors,
  CLIENT_TENANT_KEYS,
  CLIENT_TENANT_HEADERS,
};
