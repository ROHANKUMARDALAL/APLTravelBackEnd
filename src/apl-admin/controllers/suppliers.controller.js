'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const catalog = require('../../suppliers/services/supplier-catalog.service');
const {
  searchRequestLogs,
  getRequestLifecycle,
} = require('../../suppliers/services/request-log.service');

function actor(req) {
  return { id: req.admin?.id, email: req.admin?.email, type: 'APL' };
}

async function list(req, res) {
  return sendSuccess(res, await catalog.listSuppliers(req.query || {}));
}

async function get(req, res) {
  return sendSuccess(res, await catalog.getSupplier(req.params.id));
}

async function create(req, res) {
  const supplier = await catalog.createSupplier(req.body || {}, actor(req));
  return sendSuccess(res, { supplier });
}

async function update(req, res) {
  const supplier = await catalog.updateSupplier(
    req.params.id,
    req.body || {},
    actor(req),
  );
  return sendSuccess(res, { supplier });
}

async function upsertServiceMapping(req, res) {
  const mapping = await catalog.upsertSupplierServiceMapping(
    {
      supplierId: req.params.id,
      serviceId: req.body?.serviceId,
      enabled: req.body?.enabled,
      environment: req.body?.environment,
      notes: req.body?.notes,
    },
    actor(req),
  );
  return sendSuccess(res, { mapping });
}

async function listAssignments(req, res) {
  const items = await catalog.listDsaSupplierAssignments({
    dsaId: req.query?.dsaId,
    serviceId: req.query?.serviceId,
  });
  return sendSuccess(res, { items });
}

async function upsertAssignment(req, res) {
  const assignment = await catalog.upsertDsaSupplierAssignment(
    req.body || {},
    actor(req),
  );
  return sendSuccess(res, { assignment });
}

async function removeAssignment(req, res) {
  return sendSuccess(
    res,
    await catalog.deleteDsaSupplierAssignment(req.params.id, actor(req)),
  );
}

async function listRequestLogs(req, res) {
  return sendSuccess(res, await searchRequestLogs(req.query || {}));
}

async function getRequestLogDetail(req, res) {
  return sendSuccess(res, await getRequestLifecycle(req.params.requestId));
}

module.exports = {
  list,
  get,
  create,
  update,
  upsertServiceMapping,
  listAssignments,
  upsertAssignment,
  removeAssignment,
  listRequestLogs,
  getRequestLogDetail,
};
