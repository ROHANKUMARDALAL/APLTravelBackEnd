'use strict';

const { asyncHandler } = require('../../common/middleware/error-handler');
const { resolvePublicTenant } = require('../../public-site/services/resolve-tenant.service');
const {
  stripClientTenantSelectors,
  buildTransactionTenantContext,
  assertServiceOfferedForTenant,
} = require('../services/transaction-tenant.service');

/**
 * Resolve trusted DSA from host / forwarded public host (same Phase 8 resolver).
 * Client dsaId never overrides.
 */
const requireTransactionTenant = asyncHandler(async (req, _res, next) => {
  stripClientTenantSelectors(req);
  const resolved = await resolvePublicTenant(req);
  req.tenant = buildTransactionTenantContext(resolved);
  next();
});

/**
 * After tenant resolution, enforce the central offer rule for a master service code.
 */
function requireOfferedService(serviceCode) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.tenant?.dsaId) {
      // requireTransactionTenant must run first
      stripClientTenantSelectors(req);
      const resolved = await resolvePublicTenant(req);
      req.tenant = buildTransactionTenantContext(resolved);
    }
    await assertServiceOfferedForTenant(req.tenant.dsaId, serviceCode);
    next();
  });
}

module.exports = {
  requireTransactionTenant,
  requireOfferedService,
};
