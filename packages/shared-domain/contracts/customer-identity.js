'use strict';

/**
 * Future customer identity (design only — not implemented in Phase 15D).
 *
 * Direction: GLOBAL USER + DSA MEMBERSHIP
 *
 * User              = global identity (email/phone login credentials)
 * DsaCustomerMembership = relationship User ↔ DSA
 *
 * Proposed membership fields (minimal):
 *   userId, dsaId, status, createdAt, lastUsedAt
 *
 * DSA-specific later (not required now):
 *   loyalty, wallet, preferences, marketingConsent
 *
 * Do NOT add dsaId directly onto User as the sole tenancy model —
 * that breaks multi-DSA customers.
 */

const CUSTOMER_IDENTITY_DIRECTION = 'GLOBAL_USER_PLUS_DSA_MEMBERSHIP';

const FUTURE_MEMBERSHIP_FIELDS = Object.freeze([
  'userId',
  'dsaId',
  'status',
  'createdAt',
  'lastUsedAt',
]);

module.exports = {
  CUSTOMER_IDENTITY_DIRECTION,
  FUTURE_MEMBERSHIP_FIELDS,
};
