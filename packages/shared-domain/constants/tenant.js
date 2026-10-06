'use strict';

const DsaStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
});

const DSA_STATUSES = Object.freeze(Object.values(DsaStatus));

/** Keys that must never authorize tenant identity from the client. */
const CLIENT_TENANT_KEYS = Object.freeze([
  'dsaId',
  'dsa_id',
  'tenantId',
  'tenant_id',
]);

const CLIENT_TENANT_HEADERS = Object.freeze(['x-dsa-id', 'x-tenant-id']);

module.exports = {
  DsaStatus,
  DSA_STATUSES,
  CLIENT_TENANT_KEYS,
  CLIENT_TENANT_HEADERS,
};
