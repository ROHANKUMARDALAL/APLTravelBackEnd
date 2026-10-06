'use strict';

const { CLIENT_TENANT_KEYS } = require('@apl/shared-domain');
const { AppError } = require('../../common/errors/app-error');
const { evaluateServiceOffer } = require('./service-offer.service');

/**
 * Phase 9 — trusted transaction tenancy helpers.
 * Never trust client-supplied dsaId (query/body/headers).
 * Keys/headers: @apl/shared-domain tenant contract.
 */

function stripClientTenantSelectors(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const key of CLIENT_TENANT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        delete req.body[key];
      }
    }
  }
  if (req.query && typeof req.query === 'object') {
    for (const key of CLIENT_TENANT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.query, key)) {
        delete req.query[key];
      }
    }
  }
  // Never treat these as authority (production or otherwise).
  if (req.headers) {
    delete req.headers['x-dsa-id'];
    delete req.headers['x-tenant-id'];
  }
}

function buildTransactionTenantContext(resolved) {
  const dsa = resolved.dsa;
  return {
    dsaId: String(dsa._id),
    dsaCode: dsa.dsaCode ? String(dsa.dsaCode) : undefined,
    host: resolved.host,
    source: resolved.source,
    status: dsa.status,
  };
}

/**
 * Reject when the service is not effectively offered to the resolved DSA.
 * Uses the central offer rule — frontend visibility is not authorization.
 */
async function assertServiceOfferedForTenant(dsaId, serviceCode) {
  const evaluation = await evaluateServiceOffer({ dsaId, serviceCode });
  if (!evaluation.offered) {
    throw AppError.forbidden('This service is not available');
  }
  return evaluation;
}

/**
 * After Booking creation, ownership comes from Booking.dsaId.
 * Mismatch with the current request tenant fails closed.
 * Legacy bookings without dsaId remain readable by owner-scoped flows.
 */
function assertBookingTenantAccess(booking, requestTenant) {
  if (!booking) {
    throw AppError.notFound('Booking not found');
  }
  const bookingDsaId = booking.dsaId ? String(booking.dsaId) : '';
  if (!bookingDsaId) {
    return { mode: 'legacy' };
  }
  const requestDsaId = requestTenant?.dsaId ? String(requestTenant.dsaId) : '';
  if (!requestDsaId) {
    throw AppError.forbidden('Tenant context is required for this booking');
  }
  if (bookingDsaId !== requestDsaId) {
    throw AppError.forbidden('Booking is not available for this website');
  }
  return { mode: 'tenant', dsaId: bookingDsaId };
}

/**
 * Ensure a Search created under DSA A cannot be checked out under DSA B.
 */
function assertSearchTenantMatch(search, requestTenant) {
  if (!search) {
    throw AppError.notFound('Search not found');
  }
  const searchDsaId = search.dsaId ? String(search.dsaId) : '';
  const requestDsaId = requestTenant?.dsaId ? String(requestTenant.dsaId) : '';
  if (!searchDsaId) {
    // Pre-Phase-9 search caches: allow only when request also has no tenant
    // (should not happen on tenant-required routes). Fail closed if request has tenant.
    if (requestDsaId) {
      throw AppError.forbidden('Search is not available for this website');
    }
    return { mode: 'legacy' };
  }
  if (!requestDsaId || searchDsaId !== requestDsaId) {
    throw AppError.forbidden('Search is not available for this website');
  }
  return { mode: 'tenant', dsaId: searchDsaId };
}

function assertCheckoutTenantMatch(session, requestTenant) {
  if (!session) {
    throw AppError.notFound('Invalid checkoutToken');
  }
  const sessionDsaId = session.dsaId ? String(session.dsaId) : '';
  const requestDsaId = requestTenant?.dsaId ? String(requestTenant.dsaId) : '';
  if (!sessionDsaId) {
    if (requestDsaId) {
      throw AppError.forbidden('Checkout is not available for this website');
    }
    return { mode: 'legacy' };
  }
  if (!requestDsaId || sessionDsaId !== requestDsaId) {
    throw AppError.forbidden('Checkout is not available for this website');
  }
  return { mode: 'tenant', dsaId: sessionDsaId };
}

module.exports = {
  stripClientTenantSelectors,
  buildTransactionTenantContext,
  assertServiceOfferedForTenant,
  assertBookingTenantAccess,
  assertSearchTenantMatch,
  assertCheckoutTenantMatch,
  CLIENT_TENANT_KEYS,
};
