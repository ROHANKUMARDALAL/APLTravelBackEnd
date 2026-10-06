'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const {
  listMasterServices,
  getMasterServiceById,
  createMasterService,
  updateMasterService,
  toPublicService,
} = require('../../tenant/services/master-service.service');
const {
  evaluateServiceOffer,
} = require('../../tenant/services/service-offer.service');
const { logAdminAction } = require('../services/admin-action-log');

function actorFromReq(req) {
  return req.admin?.public
    ? { ...req.admin.public, type: 'APL' }
    : { id: req.admin?.id, type: 'APL' };
}

async function listServices(req, res) {
  const services = await listMasterServices({
    globalStatus: req.query.globalStatus,
  });
  return sendSuccess(res, {
    services: services.map((svc) => toPublicService(svc)),
  });
}

async function getService(req, res) {
  const service = await getMasterServiceById(req.params.id);
  return sendSuccess(res, { service: toPublicService(service) });
}

async function createService(req, res) {
  const actor = actorFromReq(req);
  const service = await createMasterService(req.body || {});
  logAdminAction({
    actor,
    action: 'service.created',
    resourceType: 'Service',
    resourceId: service._id,
    details: { code: service.code, globalStatus: service.globalStatus },
  });
  return sendSuccess(res, { service: toPublicService(service) });
}

async function updateService(req, res) {
  const actor = actorFromReq(req);
  const previous = await getMasterServiceById(req.params.id);
  const service = await updateMasterService(req.params.id, req.body || {});
  const action =
    previous.globalStatus === 'ACTIVE' && service.globalStatus === 'INACTIVE'
      ? 'service.globally_disabled'
      : 'service.updated';
  logAdminAction({
    actor,
    action,
    resourceType: 'Service',
    resourceId: service._id,
    details: {
      code: service.code,
      from: previous.globalStatus,
      to: service.globalStatus,
    },
  });
  return sendSuccess(res, {
    service: toPublicService(service.toObject ? service.toObject() : service),
  });
}

async function evaluateOffer(req, res) {
  const result = await evaluateServiceOffer({
    dsaId: req.query.dsaId,
    serviceId: req.query.serviceId,
    serviceCode: req.query.serviceCode,
  });
  return sendSuccess(res, result);
}

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  evaluateOffer,
};
