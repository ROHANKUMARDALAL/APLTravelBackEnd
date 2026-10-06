'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const { resolveTenantDsaId } = require('../../tenant/middleware/tenant-context');
const {
  getTenantDashboard,
  getTenantProfile,
  updateTenantProfile,
  getTenantServiceCatalogue,
  setTenantServiceActive,
} = require('../services/dsa-portal.service');

async function getDashboard(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const data = await getTenantDashboard(dsaId);
  return sendSuccess(res, data);
}

async function getProfile(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const dsa = await getTenantProfile(dsaId);
  return sendSuccess(res, {
    dsa,
    admin: req.admin.public,
    tenant: req.tenant,
  });
}

async function patchProfile(req, res) {
  const dsaId = resolveTenantDsaId(req);
  // Ignore any client-supplied dsaId attempting to retarget tenant.
  const body = { ...(req.body || {}) };
  delete body.dsaId;
  delete body.id;
  delete body.dsaCode;
  delete body.status;
  const dsa = await updateTenantProfile(dsaId, body);
  return sendSuccess(res, { dsa });
}

async function listServices(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const data = await getTenantServiceCatalogue(dsaId);
  return sendSuccess(res, data);
}

async function patchService(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const body = { ...(req.body || {}) };

  if (body.isAllowedByAPL !== undefined) {
    const { AppError } = require('../../common/errors/app-error');
    throw AppError.forbidden('DSAAdmin cannot modify isAllowedByAPL');
  }
  if (body.dsaId !== undefined) {
    // Explicitly ignore foreign tenant targeting.
    delete body.dsaId;
  }

  if (body.isActiveByDSA === undefined) {
    const { AppError } = require('../../common/errors/app-error');
    throw AppError.validation('isActiveByDSA is required');
  }

  const result = await setTenantServiceActive(
    dsaId,
    req.params.serviceId,
    body.isActiveByDSA,
  );
  return sendSuccess(res, result);
}

module.exports = {
  getDashboard,
  getProfile,
  patchProfile,
  listServices,
  patchService,
};
