'use strict';

const express = require('express');
const { config } = require('../common/config');
const { sendSuccess } = require('../common/response/envelope');
const { asyncHandler } = require('../common/middleware/error-handler');
const { AppError } = require('../common/errors/app-error');
const { executeSupplierSearch } = require('./execute');
const { createPlaceholderAdapter } = require('./placeholder');

function requireGatewayToken(req, _res, next) {
  const expected = config.commonSupplierGateway.internalToken;
  const provided = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || provided !== expected) {
    return next(AppError.unauthorized('Gateway authentication failed'));
  }
  const dsaId = req.get('x-apl-tenant-dsa');
  if (!dsaId) {
    return next(AppError.validation('Trusted tenant context is required'));
  }
  req.gatewayTenant = { dsaId };
  return next();
}

function createGatewayRouter() {
  const router = express.Router();
  router.use(requireGatewayToken);
  router.get('/health', asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      service: 'common-supplier-gateway',
      enabled: true,
    });
  }));
  router.post('/flights/search', asyncHandler(async (req, res) => {
    const result = await executeSupplierSearch({
      entries: req.body?.entries || [],
      serviceCode: 'flight',
      invoke: async (entry) => entry.adapter?.searchFlights?.(req.body?.criteria || {}, {
        dsaId: req.gatewayTenant.dsaId,
      }) || [],
    });
    return sendSuccess(res, {
      dsaId: req.gatewayTenant.dsaId,
      offers: result.offers.map(({ alternatives, ...offer }) => ({
        ...offer,
        alternativeCount: (alternatives || []).length,
      })),
      diagnostics: result.diagnostics,
    });
  }));
  router.get('/adapters/placeholder/:code', asyncHandler(async (req, res) => {
    const adapter = createPlaceholderAdapter(req.params.code);
    return sendSuccess(res, {
      code: adapter.code,
      integrationStatus: adapter.integrationStatus,
      missing: adapter.missing,
    });
  }));
  return router;
}

module.exports = { createGatewayRouter, requireGatewayToken };
