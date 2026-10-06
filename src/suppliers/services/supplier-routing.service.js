'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const { config } = require('../../common/config');
const Supplier = require('../../common/database/models/Supplier');
const SupplierService = require('../../common/database/models/SupplierService');
const DsaSupplier = require('../../common/database/models/DsaSupplier');
const Service = require('../../tenant/models/Service');
const { getAllFlightAdapters } = require('../../flight/suppliers/registry');
const { getAllAdapters: getAllHotelAdapters } = require('../../hotel/suppliers/registry');
const { getAllBusAdapters } = require('../../bus/suppliers/registry');
const { getAllTransferAdapters } = require('../../transfer/suppliers/registry');
const {
  resolveSupplierCredentials,
  credentialMetaPublic,
} = require('../runtime');

/**
 * Central supplier routing (Phase 10).
 *
 * Legacy mock fan-out is used ONLY when:
 * - NODE_ENV !== production AND
 * - no enabled DsaSupplier rows exist for the DSA+service
 *
 * Production never fail-opens past DSA supplier restrictions.
 */

function assertObjectId(value, field) {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
  return value;
}

function adaptersForService(serviceCode) {
  const code = String(serviceCode || '').toLowerCase();
  if (code === 'flight') return getAllFlightAdapters();
  if (code === 'hotel') return getAllHotelAdapters();
  if (code === 'bus') return getAllBusAdapters();
  if (code === 'transfer') return getAllTransferAdapters();
  return [];
}

function legacyMockPlan({ serviceCode, operation, reason }) {
  const adapters = adaptersForService(serviceCode);
  return {
    mode: 'LEGACY_MOCK_FANOUT',
    reason,
    strategy: 'PARALLEL',
    environment: 'TEST',
    serviceCode: String(serviceCode || '').toLowerCase(),
    operation,
    suppliers: adapters.map((adapter, index) => ({
      supplierId: null,
      supplierCode: adapter.code,
      name: adapter.displayName || adapter.code,
      priority: index + 1,
      isMock: true,
      environment: 'TEST',
      adapter,
    })),
  };
}

/**
 * Build eligible supplier execution plan for a DSA + service.
 */
async function buildSupplierExecutionPlan({
  dsaId,
  serviceCode,
  operation = 'search',
  environment,
}) {
  assertObjectId(dsaId, 'dsaId');
  const code = String(serviceCode || '').trim().toLowerCase();
  if (!code) throw AppError.validation('serviceCode is required');

  const service = await Service.findOne({ code }).lean();
  if (!service) throw AppError.notFound(`Service not found: ${code}`);

  const assignments = await DsaSupplier.find({
    dsaId,
    serviceId: service._id,
    enabled: true,
  })
    .sort({ priority: 1, createdAt: 1 })
    .lean();

  if (!assignments.length) {
    if (config.isProduction) {
      throw AppError.forbidden('No suppliers are assigned for this service');
    }
    return legacyMockPlan({
      serviceCode: code,
      operation,
      reason: 'NO_DSA_SUPPLIER_ASSIGNMENTS_DEV_FALLBACK',
    });
  }

  const strategy = assignments[0].routingStrategy || 'PARALLEL';
  const supplierIds = assignments.map((row) => row.supplierId);
  const [suppliers, serviceMaps] = await Promise.all([
    Supplier.find({ _id: { $in: supplierIds } }).lean(),
    SupplierService.find({
      supplierId: { $in: supplierIds },
      serviceId: service._id,
    }).lean(),
  ]);
  const supplierById = new Map(suppliers.map((s) => [String(s._id), s]));
  const mapBySupplier = new Map(
    serviceMaps.map((m) => [String(m.supplierId), m]),
  );
  const adapterByCode = new Map(
    adaptersForService(code).map((a) => [a.code, a]),
  );

  const selectedEnv = environment || null;
  const eligible = [];

  for (const row of assignments) {
    const supplier = supplierById.get(String(row.supplierId));
    if (!supplier) continue;
    if (String(supplier.status).toUpperCase() !== 'ACTIVE') continue;

    const svcMap = mapBySupplier.get(String(row.supplierId));
    if (!svcMap || svcMap.enabled !== true) continue;

    const env =
      selectedEnv ||
      svcMap.environment ||
      supplier.defaultEnvironment ||
      'TEST';
    const allowedEnvs = Array.isArray(supplier.environments)
      ? supplier.environments
      : ['TEST'];
    if (!allowedEnvs.includes(env)) continue;

    const adapter = adapterByCode.get(String(supplier.code).toUpperCase());
    // Phase 10: mock adapters only. Missing adapter → skip (not crash).
    if (!adapter) continue;

    const credentialRef =
      supplier.credentialRef || `SUPPLIER_${String(supplier.code).toUpperCase()}`;
    // Resolve from env — Mongo flag is advisory only; never put secrets on the plan.
    const resolved = resolveSupplierCredentials({
      credentialRef,
      environment: env,
      supplierCode: supplier.code,
    });

    eligible.push({
      supplierId: String(supplier._id),
      supplierCode: supplier.code,
      name: supplier.name,
      priority: row.priority,
      isMock: Boolean(supplier.isMock),
      environment: env,
      credentialRef,
      /** Safe metadata only — secret values stay off the plan object. */
      credentialsConfigured: Boolean(
        supplier.credentialsConfigured || resolved.configured,
      ),
      credentialMeta: credentialMetaPublic(resolved),
      adapter,
      assignmentId: String(row._id),
    });
  }

  if (!eligible.length) {
    if (config.isProduction) {
      throw AppError.forbidden('No eligible suppliers for this service');
    }
    return legacyMockPlan({
      serviceCode: code,
      operation,
      reason: 'NO_ELIGIBLE_SUPPLIERS_DEV_FALLBACK',
    });
  }

  // Deterministic priority ordering
  eligible.sort((a, b) => a.priority - b.priority || a.supplierCode.localeCompare(b.supplierCode));

  // Phase 10: execute all eligible mocks for observability regardless of strategy.
  // PRIORITY/FALLBACK remain explicit on the plan for Phase 11 short-circuit behavior.
  const planned = eligible;

  return {
    mode: 'DSA_ASSIGNED',
    reason: 'DSA_SUPPLIER_ASSIGNMENTS',
    strategy,
    environment: planned[0]?.environment || 'TEST',
    serviceCode: code,
    operation,
    suppliers: planned,
  };
}

module.exports = {
  buildSupplierExecutionPlan,
  legacyMockPlan,
};
