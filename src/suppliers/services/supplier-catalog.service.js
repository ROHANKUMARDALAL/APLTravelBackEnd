'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Supplier = require('../../common/database/models/Supplier');
const SupplierService = require('../../common/database/models/SupplierService');
const DsaSupplier = require('../../common/database/models/DsaSupplier');
const Service = require('../../tenant/models/Service');
const { logAdminAction } = require('../../apl-admin/services/admin-action-log');

const STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];
const ENVS = ['TEST', 'LIVE'];
const STRATEGIES = ['PARALLEL', 'PRIORITY', 'FALLBACK'];

function assertObjectId(value, field) {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
  return value;
}

function publicSupplier(doc, extras = {}) {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    description: doc.description || '',
    status: doc.status,
    isMock: Boolean(doc.isMock),
    environments: doc.environments || ['TEST'],
    defaultEnvironment: doc.defaultEnvironment || 'TEST',
    credentialRef: doc.credentialRef || '',
    credentialsConfigured: Boolean(doc.credentialsConfigured),
    metadata: doc.metadata || {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...extras,
  };
}

async function listSuppliers({ status, q, page = 1, pageSize = 50 } = {}) {
  const filter = {};
  if (status) {
    const s = String(status).toUpperCase();
    if (!STATUSES.includes(s)) throw AppError.validation('Invalid status');
    filter.status = s;
  }
  if (q) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: rx }, { name: rx }];
  }
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
  const [total, rows] = await Promise.all([
    Supplier.countDocuments(filter),
    Supplier.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeSize)
      .limit(safeSize)
      .lean(),
  ]);
  return {
    items: rows.map((r) => publicSupplier(r)),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / safeSize)),
    },
  };
}

async function getSupplier(id) {
  assertObjectId(id, 'id');
  const doc = await Supplier.findById(id).lean();
  if (!doc) throw AppError.notFound('Supplier not found');
  const maps = await SupplierService.find({ supplierId: doc._id }).lean();
  const serviceIds = maps.map((m) => m.serviceId);
  const services = await Service.find({ _id: { $in: serviceIds } }).lean();
  const byId = new Map(services.map((s) => [String(s._id), s]));
  return {
    supplier: publicSupplier(doc),
    serviceMappings: maps.map((m) => ({
      id: String(m._id),
      serviceId: String(m.serviceId),
      serviceCode: byId.get(String(m.serviceId))?.code || null,
      serviceName: byId.get(String(m.serviceId))?.name || null,
      enabled: m.enabled,
      environment: m.environment,
      notes: m.notes || '',
    })),
  };
}

async function createSupplier(input, actor) {
  const code = String(input.code || '')
    .trim()
    .toUpperCase();
  const name = String(input.name || '').trim();
  if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
    throw AppError.validation('code must be 2–40 chars A-Z / 0-9 / _');
  }
  if (!name) throw AppError.validation('name is required');

  const environments = Array.isArray(input.environments)
    ? input.environments.map((e) => String(e).toUpperCase())
    : ['TEST'];
  for (const env of environments) {
    if (!ENVS.includes(env)) throw AppError.validation(`Invalid environment: ${env}`);
  }
  const defaultEnvironment = String(
    input.defaultEnvironment || environments[0] || 'TEST',
  ).toUpperCase();
  if (!ENVS.includes(defaultEnvironment)) {
    throw AppError.validation('Invalid defaultEnvironment');
  }

  try {
    const doc = await Supplier.create({
      code,
      name,
      description: String(input.description || '').slice(0, 2000),
      status: STATUSES.includes(String(input.status || '').toUpperCase())
        ? String(input.status).toUpperCase()
        : 'ACTIVE',
      isMock: input.isMock !== false,
      environments,
      defaultEnvironment,
      credentialRef: String(input.credentialRef || `SUPPLIER_${code}`).slice(0, 120),
      credentialsConfigured: Boolean(input.credentialsConfigured),
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    });
    logAdminAction({
      actor,
      action: 'supplier.create',
      resourceType: 'Supplier',
      resourceId: doc._id,
      details: { code: doc.code, status: doc.status },
    });
    return publicSupplier(doc);
  } catch (err) {
    if (err && err.code === 11000) {
      throw AppError.validation('Supplier code already exists', [{ code }]);
    }
    throw err;
  }
}

async function updateSupplier(id, input, actor) {
  assertObjectId(id, 'id');
  const doc = await Supplier.findById(id);
  if (!doc) throw AppError.notFound('Supplier not found');
  // code is immutable
  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) throw AppError.validation('name is required');
    doc.name = name;
  }
  if (input.description !== undefined) {
    doc.description = String(input.description || '').slice(0, 2000);
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!STATUSES.includes(status)) throw AppError.validation('Invalid status');
    doc.status = status;
  }
  if (input.isMock !== undefined) doc.isMock = Boolean(input.isMock);
  if (input.environments !== undefined) {
    const environments = (input.environments || []).map((e) => String(e).toUpperCase());
    for (const env of environments) {
      if (!ENVS.includes(env)) throw AppError.validation(`Invalid environment: ${env}`);
    }
    doc.environments = environments.length ? environments : ['TEST'];
  }
  if (input.defaultEnvironment !== undefined) {
    const env = String(input.defaultEnvironment).toUpperCase();
    if (!ENVS.includes(env)) throw AppError.validation('Invalid defaultEnvironment');
    doc.defaultEnvironment = env;
  }
  if (input.credentialRef !== undefined) {
    doc.credentialRef = String(input.credentialRef || '').slice(0, 120);
  }
  if (input.credentialsConfigured !== undefined) {
    doc.credentialsConfigured = Boolean(input.credentialsConfigured);
  }
  if (input.metadata !== undefined && typeof input.metadata === 'object') {
    doc.metadata = input.metadata;
  }
  await doc.save();
  logAdminAction({
    actor,
    action: 'supplier.update',
    resourceType: 'Supplier',
    resourceId: doc._id,
    details: {
      code: doc.code,
      status: doc.status,
      defaultEnvironment: doc.defaultEnvironment,
      credentialsConfigured: doc.credentialsConfigured,
    },
  });
  return publicSupplier(doc);
}

async function upsertSupplierServiceMapping(
  { supplierId, serviceId, enabled = true, environment = null, notes = '' },
  actor,
) {
  assertObjectId(supplierId, 'supplierId');
  assertObjectId(serviceId, 'serviceId');
  const [supplier, service] = await Promise.all([
    Supplier.findById(supplierId).lean(),
    Service.findById(serviceId).lean(),
  ]);
  if (!supplier) throw AppError.notFound('Supplier not found');
  if (!service) throw AppError.notFound('Service not found');
  if (environment != null) {
    const env = String(environment).toUpperCase();
    if (!ENVS.includes(env)) throw AppError.validation('Invalid environment');
    environment = env;
  }
  const doc = await SupplierService.findOneAndUpdate(
    { supplierId, serviceId },
    {
      $set: {
        enabled: Boolean(enabled),
        environment,
        notes: String(notes || '').slice(0, 500),
      },
    },
    { upsert: true, new: true },
  );
  logAdminAction({
    actor,
    action: 'supplier.service_mapping.upsert',
    resourceType: 'SupplierService',
    resourceId: doc._id,
    details: {
      supplierCode: supplier.code,
      serviceCode: service.code,
      enabled: doc.enabled,
    },
  });
  return {
    id: String(doc._id),
    supplierId: String(doc.supplierId),
    serviceId: String(doc.serviceId),
    enabled: doc.enabled,
    environment: doc.environment,
    notes: doc.notes || '',
  };
}

async function listDsaSupplierAssignments({ dsaId, serviceId } = {}) {
  const filter = {};
  if (dsaId) {
    assertObjectId(dsaId, 'dsaId');
    filter.dsaId = dsaId;
  }
  if (serviceId) {
    assertObjectId(serviceId, 'serviceId');
    filter.serviceId = serviceId;
  }
  const rows = await DsaSupplier.find(filter).sort({ priority: 1 }).lean();
  const supplierIds = [...new Set(rows.map((r) => String(r.supplierId)))];
  const serviceIds = [...new Set(rows.map((r) => String(r.serviceId)))];
  const [suppliers, services] = await Promise.all([
    Supplier.find({ _id: { $in: supplierIds } }).lean(),
    Service.find({ _id: { $in: serviceIds } }).lean(),
  ]);
  const sBy = new Map(suppliers.map((s) => [String(s._id), s]));
  const svcBy = new Map(services.map((s) => [String(s._id), s]));
  return rows.map((r) => ({
    id: String(r._id),
    dsaId: String(r.dsaId),
    serviceId: String(r.serviceId),
    serviceCode: svcBy.get(String(r.serviceId))?.code || null,
    serviceName: svcBy.get(String(r.serviceId))?.name || null,
    supplierId: String(r.supplierId),
    supplierCode: sBy.get(String(r.supplierId))?.code || null,
    supplierName: sBy.get(String(r.supplierId))?.name || null,
    enabled: r.enabled,
    priority: r.priority,
    routingStrategy: r.routingStrategy,
    notes: r.notes || '',
  }));
}

async function upsertDsaSupplierAssignment(input, actor) {
  const dsaId = assertObjectId(input.dsaId, 'dsaId');
  const serviceId = assertObjectId(input.serviceId, 'serviceId');
  const supplierId = assertObjectId(input.supplierId, 'supplierId');
  const priority = Number(input.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 1000) {
    throw AppError.validation('priority must be an integer 1–1000');
  }
  const routingStrategy = String(input.routingStrategy || 'PARALLEL').toUpperCase();
  if (!STRATEGIES.includes(routingStrategy)) {
    throw AppError.validation('Invalid routingStrategy');
  }

  const [supplier, service, svcMap] = await Promise.all([
    Supplier.findById(supplierId).lean(),
    Service.findById(serviceId).lean(),
    SupplierService.findOne({ supplierId, serviceId }).lean(),
  ]);
  if (!supplier) throw AppError.notFound('Supplier not found');
  if (!service) throw AppError.notFound('Service not found');
  if (!svcMap || svcMap.enabled !== true) {
    throw AppError.validation(
      'Supplier must be enabled for this service before DSA assignment',
    );
  }

  let doc;
  try {
    doc = await DsaSupplier.findOneAndUpdate(
      { dsaId, serviceId, supplierId },
      {
        $set: {
          enabled: input.enabled !== false,
          priority,
          routingStrategy,
          notes: String(input.notes || '').slice(0, 500),
        },
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    if (err && err.code === 11000) {
      throw AppError.validation('Duplicate DSA/service/supplier mapping');
    }
    throw err;
  }

  logAdminAction({
    actor,
    action: 'supplier.dsa_assignment.upsert',
    resourceType: 'DsaSupplier',
    resourceId: doc._id,
    details: {
      dsaId: String(dsaId),
      serviceCode: service.code,
      supplierCode: supplier.code,
      enabled: doc.enabled,
      priority: doc.priority,
      routingStrategy: doc.routingStrategy,
    },
  });

  return {
    id: String(doc._id),
    dsaId: String(doc.dsaId),
    serviceId: String(doc.serviceId),
    supplierId: String(doc.supplierId),
    enabled: doc.enabled,
    priority: doc.priority,
    routingStrategy: doc.routingStrategy,
    notes: doc.notes || '',
  };
}

async function deleteDsaSupplierAssignment(id, actor) {
  assertObjectId(id, 'id');
  const doc = await DsaSupplier.findByIdAndDelete(id);
  if (!doc) throw AppError.notFound('Assignment not found');
  logAdminAction({
    actor,
    action: 'supplier.dsa_assignment.delete',
    resourceType: 'DsaSupplier',
    resourceId: id,
    details: {
      dsaId: String(doc.dsaId),
      serviceId: String(doc.serviceId),
      supplierId: String(doc.supplierId),
    },
  });
  return { deleted: true, id: String(id) };
}

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  upsertSupplierServiceMapping,
  listDsaSupplierAssignments,
  upsertDsaSupplierAssignment,
  deleteDsaSupplierAssignment,
  publicSupplier,
  STATUSES,
  ENVS,
  STRATEGIES,
};
