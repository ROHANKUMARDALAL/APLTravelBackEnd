'use strict';

const { AppError } = require('../../common/errors/app-error');

/**
 * Phase 3 foundation for tenant-aware handlers.
 * Phase 4 DSAAdmin auth will set req.tenant = { dsaId, dsaCode, source: 'session' }.
 *
 * Never trust a client-supplied dsaId for tenant-scoped DSAAdmin operations.
 * Use resolveTenantDsaId(req) which only reads authenticated context.
 */

function getTenantContext(req) {
  return req.tenant || null;
}

/**
 * Returns the authenticated DSA id from request context.
 * Throws if missing — Phase 4 login middleware must populate req.tenant.
 */
function resolveTenantDsaId(req) {
  const tenant = getTenantContext(req);
  const dsaId = tenant && tenant.dsaId ? String(tenant.dsaId) : '';
  if (!dsaId) {
    throw AppError.unauthorized(
      'Tenant context is required. Authenticate as a DSAAdmin user (Phase 4).',
    );
  }
  return dsaId;
}

/**
 * Middleware that requires req.tenant.dsaId.
 * Not mounted on public mutation routes until Phase 4 auth exists.
 */
function requireTenantContext(req, _res, next) {
  try {
    resolveTenantDsaId(req);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Test/helper only: attach a tenant context explicitly (never from untrusted body).
 */
function attachTenantContext(req, { dsaId, dsaCode, source = 'session' }) {
  req.tenant = {
    dsaId: String(dsaId),
    dsaCode: dsaCode ? String(dsaCode) : undefined,
    source,
  };
  return req.tenant;
}

module.exports = {
  getTenantContext,
  resolveTenantDsaId,
  requireTenantContext,
  attachTenantContext,
};
