'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const {
  createDsa,
  listDsasPaginated,
  getDsaById,
  updateDsa,
  setDsaStatus,
  toPublicDsa,
} = require('../../tenant/services/dsa.service');
const {
  listDsaServiceCatalogue,
  setServiceAllowedByApl,
} = require('../../tenant/services/dsa-service-mapping.service');
const {
  listDsaAdminUsers,
  provisionDsaAdminByApl,
} = require('../../dsa-admin/services/dsa-auth.service');
const { logAdminAction } = require('../services/admin-action-log');

function actorFromReq(req) {
  return req.admin?.public
    ? { ...req.admin.public, type: 'APL' }
    : { id: req.admin?.id, type: 'APL' };
}

async function listDsas(req, res) {
  const result = await listDsasPaginated({
    status: req.query.status,
    q: req.query.q,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  return sendSuccess(res, result);
}

async function getDsa(req, res) {
  const dsa = await getDsaById(req.params.id);
  return sendSuccess(res, { dsa: toPublicDsa(dsa) });
}

async function create(req, res) {
  const actor = actorFromReq(req);
  const dsa = await createDsa(req.body || {});
  logAdminAction({
    actor,
    action: 'dsa.created',
    resourceType: 'Dsa',
    resourceId: dsa._id,
    details: { dsaCode: dsa.dsaCode, status: dsa.status },
  });
  return sendSuccess(res, { dsa: toPublicDsa(dsa) });
}

async function update(req, res) {
  const actor = actorFromReq(req);
  const dsa = await updateDsa(req.params.id, req.body || {});
  logAdminAction({
    actor,
    action: 'dsa.updated',
    resourceType: 'Dsa',
    resourceId: dsa._id,
    details: { dsaCode: dsa.dsaCode },
  });
  return sendSuccess(res, { dsa: toPublicDsa(dsa.toObject ? dsa.toObject() : dsa) });
}

async function changeStatus(req, res) {
  const actor = actorFromReq(req);
  const { dsa, previousStatus } = await setDsaStatus(
    req.params.id,
    req.body?.status,
  );
  logAdminAction({
    actor,
    action:
      dsa.status === 'SUSPENDED'
        ? 'dsa.suspended'
        : dsa.status === 'ARCHIVED'
          ? 'dsa.archived'
          : 'dsa.status_changed',
    resourceType: 'Dsa',
    resourceId: dsa._id,
    details: {
      dsaCode: dsa.dsaCode,
      from: previousStatus,
      to: dsa.status,
    },
  });
  return sendSuccess(res, {
    dsa: toPublicDsa(dsa.toObject ? dsa.toObject() : dsa),
    previousStatus,
  });
}

async function listDsaServices(req, res) {
  const catalogue = await listDsaServiceCatalogue(req.params.id);
  return sendSuccess(res, catalogue);
}

async function patchDsaService(req, res) {
  const actor = actorFromReq(req);
  const { mapping, dsa, service } = await setServiceAllowedByApl({
    dsaId: req.params.id,
    serviceId: req.params.serviceId,
    isAllowedByAPL: req.body?.isAllowedByAPL,
    displayOrder: req.body?.displayOrder,
  });

  logAdminAction({
    actor,
    action: mapping.isAllowedByAPL
      ? 'service.assigned_to_dsa'
      : 'service.revoked_from_dsa',
    resourceType: 'DsaService',
    resourceId: mapping._id,
    details: {
      dsaId: String(dsa._id),
      dsaCode: dsa.dsaCode,
      serviceCode: service.code,
      isAllowedByAPL: mapping.isAllowedByAPL,
      isActiveByDSA: mapping.isActiveByDSA,
    },
  });

  return sendSuccess(res, {
    mapping: {
      id: String(mapping._id),
      dsaId: String(mapping.dsaId),
      serviceId: String(mapping.serviceId),
      isAllowedByAPL: mapping.isAllowedByAPL,
      isActiveByDSA: mapping.isActiveByDSA,
      displayOrder: mapping.displayOrder,
    },
  });
}

async function listAdmins(req, res) {
  const result = await listDsaAdminUsers(req.params.id);
  return sendSuccess(res, result);
}

async function provisionAdmin(req, res) {
  const actor = actorFromReq(req);
  const body = req.body || {};
  const result = await provisionDsaAdminByApl({
    dsaId: req.params.id,
    name: body.name,
    email: body.email,
    phone: body.phone,
    roleCode: body.roleCode || 'DSA_OWNER',
    // Optional explicit password (still returned once). Prefer omit → generated.
    password: body.password,
  });

  logAdminAction({
    actor,
    action: 'dsa_admin.provisioned',
    resourceType: 'DsaAdminUser',
    resourceId: result.admin.id,
    details: {
      dsaId: req.params.id,
      email: result.admin.email,
      roleCode: result.admin.roleCode,
      passwordDelivery: result.passwordDelivery,
    },
  });

  return sendSuccess(res, result);
}

module.exports = {
  listDsas,
  getDsa,
  create,
  update,
  changeStatus,
  listDsaServices,
  patchDsaService,
  listAdmins,
  provisionAdmin,
};
