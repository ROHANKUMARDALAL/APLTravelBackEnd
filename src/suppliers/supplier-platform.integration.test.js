'use strict';

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../common/database/connection');
const { createApp } = require('../app');
const { seedAdminRoles } = require('../admin-auth/services/seed-roles');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { createAplAdminUser } = require('../apl-admin/services/apl-auth.service');
const { createDsaAdminUser } = require('../dsa-admin/services/dsa-auth.service');
const { createDsa } = require('../tenant/services/dsa.service');
const {
  upsertDsaServiceMapping,
} = require('../tenant/services/dsa-service-mapping.service');
const Service = require('../tenant/models/Service');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const DsaSupplier = require('../common/database/models/DsaSupplier');
const ServiceLog = require('../common/database/models/ServiceLog');
const { redact } = require('../common/utils/redact');
const {
  buildSupplierExecutionPlan,
} = require('./services/supplier-routing.service');
const catalog = require('./services/supplier-catalog.service');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function httpJson(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('redaction', () => {
  it('14) redacts sensitive fields before persistence helpers', () => {
    const out = redact({
      password: 'secret',
      apiKey: 'abc',
      cardNumber: '4111',
      nested: { token: 'x', ok: 1 },
    });
    assert.equal(out.password, '[redacted]');
    assert.equal(out.apiKey, '[redacted]');
    assert.equal(out.cardNumber, '[redacted]');
    assert.equal(out.nested.token, '[redacted]');
    assert.equal(out.nested.ok, 1);
  });
});

describeDb('Phase 10 supplier platform', () => {
  let server;
  let port;
  let aplToken;
  let dsaToken;
  let dsaId;
  let flightId;
  let hotelId;
  let supplierA;
  let supplierB;
  const password = 'Phase10Pass123!';
  const stamp = Date.now();

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    const aplEmail = `p10.apl.${stamp}@example.com`;
    await createAplAdminUser({
      name: 'P10 APL',
      email: aplEmail,
      password,
      roleCode: 'SUPER_ADMIN',
    });
    const aplLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    aplToken = aplLogin.json.data.token;

    const dsa = await createDsa({
      companyName: 'P10 DSA',
      displayName: 'P10',
      ownerName: 'Owner',
      email: `p10.dsa.${stamp}@example.com`,
      phone: '+919900001010',
      status: 'ACTIVE',
    });
    dsaId = String(dsa._id);
    const dsaEmail = `p10.owner.${stamp}@example.com`;
    await createDsaAdminUser({
      dsaId,
      name: 'P10 Owner',
      email: dsaEmail,
      password,
      roleCode: 'DSA_OWNER',
    });
    const dsaLogin = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password },
    });
    dsaToken = dsaLogin.json.data.token;

    flightId = String((await Service.findOne({ code: 'flight' }))._id);
    hotelId = String((await Service.findOne({ code: 'hotel' }))._id);
    await upsertDsaServiceMapping({
      dsaId,
      serviceId: flightId,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });

    supplierA = await catalog.createSupplier(
      {
        code: `P10A${String(stamp).slice(-4)}`,
        name: 'P10 Supplier A',
        status: 'ACTIVE',
        isMock: true,
        environments: ['TEST'],
        defaultEnvironment: 'TEST',
      },
      { email: aplEmail },
    );
    supplierB = await catalog.createSupplier(
      {
        code: `P10B${String(stamp).slice(-4)}`,
        name: 'P10 Supplier B',
        status: 'ACTIVE',
        isMock: true,
      },
      { email: aplEmail },
    );

    // Map only A to flight for deterministic routing tests — also seed TBO for mock adapter path
    await catalog.upsertSupplierServiceMapping(
      { supplierId: supplierA.id, serviceId: flightId, enabled: true },
      { email: aplEmail },
    );
    await catalog.upsertSupplierServiceMapping(
      { supplierId: supplierB.id, serviceId: flightId, enabled: true },
      { email: aplEmail },
    );

    // Ensure mock adapters exist in catalog for live fan-out compatibility
    for (const code of ['TBO', 'TRIPJACK', 'KAFILA']) {
      const s = await Supplier.findOneAndUpdate(
        { code },
        {
          $set: {
            name: `${code} (Mock)`,
            status: 'ACTIVE',
            isMock: true,
            environments: ['TEST'],
            defaultEnvironment: 'TEST',
          },
          $setOnInsert: { code },
        },
        { upsert: true, new: true },
      );
      await SupplierService.findOneAndUpdate(
        { supplierId: s._id, serviceId: flightId },
        { $set: { enabled: true } },
        { upsert: true },
      );
      await SupplierService.findOneAndUpdate(
        { supplierId: s._id, serviceId: hotelId },
        { $set: { enabled: true } },
        { upsert: true },
      );
    }
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await DsaSupplier.deleteMany({ dsaId });
    await SupplierService.deleteMany({
      supplierId: { $in: [supplierA?.id, supplierB?.id].filter(Boolean) },
    });
    await Supplier.deleteMany({
      _id: { $in: [supplierA?.id, supplierB?.id].filter(Boolean) },
    });
    await disconnectDatabase();
  });

  it('1+9) supplier catalog requires APL token', async () => {
    const anon = await httpJson(port, 'GET', '/api/apl-admin/suppliers');
    assert.equal(anon.status, 401);
    const ok = await httpJson(port, 'GET', '/api/apl-admin/suppliers', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.json.data.items));
  });

  it('2) duplicate supplier code prevented', async () => {
    const res = await httpJson(port, 'POST', '/api/apl-admin/suppliers', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: {
        code: supplierA.code,
        name: 'Dup',
      },
    });
    assert.equal(res.status, 400);
  });

  it('3) supplier-service mapping works', async () => {
    const res = await httpJson(
      port,
      'PUT',
      `/api/apl-admin/suppliers/${supplierA.id}/services`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: { serviceId: hotelId, enabled: true },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mapping.enabled, true);
  });

  it('4) duplicate DSA/service/supplier mapping upserts same row', async () => {
    const body = {
      dsaId,
      serviceId: flightId,
      supplierId: supplierA.id,
      priority: 1,
      routingStrategy: 'PARALLEL',
      enabled: true,
    };
    const a = await httpJson(port, 'PUT', '/api/apl-admin/supplier-assignments', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body,
    });
    const b = await httpJson(port, 'PUT', '/api/apl-admin/supplier-assignments', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: { ...body, priority: 2 },
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.json.data.assignment.id, b.json.data.assignment.id);
    assert.equal(b.json.data.assignment.priority, 2);
  });

  it('5-8) routing excludes disabled / unassigned; priority deterministic', async () => {
    // Assign A priority 1, B priority 2
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId,
        serviceId: flightId,
        supplierId: supplierA.id,
        priority: 1,
        enabled: true,
        routingStrategy: 'PARALLEL',
      },
      {},
    );
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId,
        serviceId: flightId,
        supplierId: supplierB.id,
        priority: 2,
        enabled: true,
        routingStrategy: 'PARALLEL',
      },
      {},
    );

    let plan = await buildSupplierExecutionPlan({
      dsaId,
      serviceCode: 'flight',
      operation: 'search',
    });
    // No adapters for P10A/P10B codes → eligible empty → dev fallback
    assert.ok(plan.mode === 'DSA_ASSIGNED' || plan.mode === 'LEGACY_MOCK_FANOUT');

    // Use real mock suppliers with adapters
    const tbo = await Supplier.findOne({ code: 'TBO' });
    const tj = await Supplier.findOne({ code: 'TRIPJACK' });
    await DsaSupplier.deleteMany({ dsaId, serviceId: flightId });
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId,
        serviceId: flightId,
        supplierId: String(tbo._id),
        priority: 2,
        enabled: true,
        routingStrategy: 'PARALLEL',
      },
      {},
    );
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId,
        serviceId: flightId,
        supplierId: String(tj._id),
        priority: 1,
        enabled: true,
        routingStrategy: 'PARALLEL',
      },
      {},
    );
    plan = await buildSupplierExecutionPlan({
      dsaId,
      serviceCode: 'flight',
    });
    assert.equal(plan.mode, 'DSA_ASSIGNED');
    assert.equal(plan.suppliers[0].supplierCode, 'TRIPJACK');
    assert.equal(plan.suppliers[1].supplierCode, 'TBO');

    // Disable B (TBO assignment)
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId,
        serviceId: flightId,
        supplierId: String(tbo._id),
        priority: 2,
        enabled: false,
        routingStrategy: 'PARALLEL',
      },
      {},
    );
    plan = await buildSupplierExecutionPlan({ dsaId, serviceCode: 'flight' });
    assert.ok(plan.suppliers.every((s) => s.supplierCode !== 'TBO'));

    // Disable supplier-service for TripJack
    await catalog.upsertSupplierServiceMapping(
      { supplierId: String(tj._id), serviceId: flightId, enabled: false },
      {},
    );
    plan = await buildSupplierExecutionPlan({ dsaId, serviceCode: 'flight' });
    // No eligible → legacy mock in non-production
    assert.ok(
      plan.mode === 'LEGACY_MOCK_FANOUT' || plan.suppliers.length === 0,
    );
    // restore
    await catalog.upsertSupplierServiceMapping(
      { supplierId: String(tj._id), serviceId: flightId, enabled: true },
      {},
    );
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId,
        serviceId: flightId,
        supplierId: String(tbo._id),
        priority: 2,
        enabled: true,
        routingStrategy: 'PARALLEL',
      },
      {},
    );
  });

  it('10) DSAAdmin cannot access supplier management', async () => {
    const res = await httpJson(port, 'GET', '/api/apl-admin/suppliers', {
      headers: { Authorization: `Bearer ${dsaToken}` },
    });
    assert.equal(res.status, 401);
  });

  it('11-13+17) flight search lifecycle shares requestId/dsaId; mock flow works', async () => {
    // Ensure DSA has mock suppliers assigned
    const tbo = await Supplier.findOne({ code: 'TBO' });
    const tj = await Supplier.findOne({ code: 'TRIPJACK' });
    const kaf = await Supplier.findOne({ code: 'KAFILA' });
    await DsaSupplier.deleteMany({ dsaId, serviceId: flightId });
    let p = 1;
    for (const s of [tbo, tj, kaf]) {
      await catalog.upsertDsaSupplierAssignment(
        {
          dsaId,
          serviceId: flightId,
          supplierId: String(s._id),
          priority: p++,
          enabled: true,
          routingStrategy: 'PARALLEL',
        },
        {},
      );
    }

    const requestId = `p10-life-${stamp}`;
    const host = `p10-${stamp}.example.test`;
    const Dsa = require('../tenant/models/Dsa');
    await Dsa.updateOne({ _id: dsaId }, { $set: { domain: host, status: 'ACTIVE' } });

    const search = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: {
        'X-APL-Public-Host': host,
        'x-request-id': requestId,
      },
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-12-01',
        adults: 1,
      },
    });
    assert.equal(search.status, 200, JSON.stringify(search.json));
    await new Promise((r) => setTimeout(r, 200));

    const logs = await ServiceLog.find({ requestId }).sort({ createdAt: 1 }).lean();
    assert.ok(logs.length >= 3);
    assert.ok(logs.every((l) => String(l.dsaId) === dsaId));
    const stages = new Set(logs.map((l) => l.stage).filter(Boolean));
    assert.ok(stages.has('NORMALIZED_REQUEST') || stages.has('INBOUND_REQUEST'));
    assert.ok(stages.has('SUPPLIER_RESPONSE'));
    const supplierBranches = logs.filter((l) => l.supplierCode);
    assert.ok(supplierBranches.length >= 2);

    const list = await httpJson(port, 'GET', `/api/apl-admin/request-logs?requestId=${requestId}`, {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    assert.equal(list.status, 200);
    assert.ok(list.json.data.items.some((i) => i.requestId === requestId));

    const detail = await httpJson(
      port,
      'GET',
      `/api/apl-admin/request-logs/${requestId}`,
      { headers: { Authorization: `Bearer ${aplToken}` } },
    );
    assert.equal(detail.status, 200);
    assert.ok(detail.json.data.timeline.length >= 2);
  });
});
