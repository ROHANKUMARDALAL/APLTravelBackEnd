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
const { createDsa } = require('../tenant/services/dsa.service');
const {
  createDsaAdminUser,
} = require('./services/dsa-auth.service');
const {
  createAplAdminUser,
} = require('../apl-admin/services/apl-auth.service');
const {
  setServiceAllowedByApl,
} = require('../tenant/services/dsa-service-mapping.service');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const DsaService = require('../tenant/models/DsaService');
const DsaAdminUser = require('./models/DsaAdminUser');
const DsaAdminSession = require('./models/DsaAdminSession');
const AplAdminUser = require('../apl-admin/models/AplAdminUser');
const AplAdminSession = require('../apl-admin/models/AplAdminSession');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function httpJson(port, method, path, { body, token } = {}) {
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

describeDb('DSAAdmin Phase 6 core APIs', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let dsaAToken;
  let supportToken;
  let aplToken;
  let flightId;
  let hotelId;
  let busId;
  const password = 'Phase6Pass123!';
  const emails = [];
  const dsaIds = [];

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    dsaA = await createDsa({
      companyName: 'Phase6 DSA A',
      displayName: 'DSA A',
      ownerName: 'Owner A',
      email: `p6.a.${Date.now()}@example.com`,
      phone: '+919600000001',
      status: 'ACTIVE',
    });
    dsaB = await createDsa({
      companyName: 'Phase6 DSA B',
      displayName: 'DSA B',
      ownerName: 'Owner B',
      email: `p6.b.${Date.now()}@example.com`,
      phone: '+919600000002',
      status: 'ACTIVE',
    });
    dsaIds.push(String(dsaA._id), String(dsaB._id));

    const ownerEmail = `p6.owner.${Date.now()}@example.com`;
    emails.push(ownerEmail);
    await createDsaAdminUser({
      dsaId: dsaA._id,
      name: 'Owner A',
      email: ownerEmail,
      password,
      roleCode: 'DSA_OWNER',
    });
    const login = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: ownerEmail, password },
    });
    dsaAToken = login.json.data.token;

    const supportEmail = `p6.support.${Date.now()}@example.com`;
    emails.push(supportEmail);
    await createDsaAdminUser({
      dsaId: dsaA._id,
      name: 'Support A',
      email: supportEmail,
      password,
      roleCode: 'SUPPORT',
    });
    const supportLogin = await httpJson(
      port,
      'POST',
      '/api/dsa-admin/auth/login',
      { body: { email: supportEmail, password } },
    );
    supportToken = supportLogin.json.data.token;

    const aplEmail = `p6.apl.${Date.now()}@example.com`;
    emails.push(aplEmail);
    await createAplAdminUser({
      name: 'APL P6',
      email: aplEmail,
      password,
      roleCode: 'SUPER_ADMIN',
    });
    const aplLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    aplToken = aplLogin.json.data.token;

    const services = await Service.find({
      code: { $in: ['flight', 'hotel', 'bus'] },
    }).lean();
    flightId = String(services.find((s) => s.code === 'flight')._id);
    hotelId = String(services.find((s) => s.code === 'hotel')._id);
    busId = String(services.find((s) => s.code === 'bus')._id);

    await setServiceAllowedByApl({
      dsaId: dsaA._id,
      serviceId: flightId,
      isAllowedByAPL: true,
    });
    await setServiceAllowedByApl({
      dsaId: dsaA._id,
      serviceId: hotelId,
      isAllowedByAPL: true,
    });
    // bus intentionally not allowed
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await DsaService.deleteMany({ dsaId: { $in: dsaIds } });
    await Dsa.deleteMany({ _id: { $in: dsaIds } });
    const dsaUsers = await DsaAdminUser.find({ email: { $in: emails } });
    await DsaAdminSession.deleteMany({
      userId: { $in: dsaUsers.map((u) => u._id) },
    });
    await DsaAdminUser.deleteMany({ email: { $in: emails } });
    const aplUsers = await AplAdminUser.find({ email: { $in: emails } });
    await AplAdminSession.deleteMany({
      userId: { $in: aplUsers.map((u) => u._id) },
    });
    await AplAdminUser.deleteMany({ email: { $in: emails } });
    await disconnectDatabase();
  });

  it('DSA profile resolves from session tenant', async () => {
    const res = await httpJson(port, 'GET', '/api/dsa-admin/profile', {
      token: dsaAToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.dsa.id, String(dsaA._id));
    assert.equal(res.json.data.tenant.source, 'session');
  });

  it('foreign/client-supplied dsaId cannot override tenant', async () => {
    const res = await httpJson(
      port,
      'GET',
      `/api/dsa-admin/profile?dsaId=${dsaB._id}`,
      { token: dsaAToken },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.dsa.id, String(dsaA._id));
    assert.notEqual(res.json.data.dsa.id, String(dsaB._id));
  });

  it('services return correct tenant mapping context', async () => {
    const res = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      token: dsaAToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.dsa.id, String(dsaA._id));
    const byCode = Object.fromEntries(
      res.json.data.services.map((s) => [s.service.code, s]),
    );
    assert.equal(byCode.flight.mapping.isAllowedByAPL, true);
    assert.equal(byCode.hotel.mapping.isAllowedByAPL, true);
    assert.equal(byCode.bus.mapping.isAllowedByAPL, false);
  });

  it('DSA can change isActiveByDSA', async () => {
    const res = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${hotelId}`,
      { token: dsaAToken, body: { isActiveByDSA: true } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.mapping.isActiveByDSA, true);
    assert.equal(res.json.data.mapping.isAllowedByAPL, true);
  });

  it('DSA cannot change isAllowedByAPL', async () => {
    const res = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${busId}`,
      {
        token: dsaAToken,
        body: { isActiveByDSA: true, isAllowedByAPL: true },
      },
    );
    assert.equal(res.status, 403);
  });

  it('DSA cannot activate APL-revoked service', async () => {
    const res = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${busId}`,
      { token: dsaAToken, body: { isActiveByDSA: true } },
    );
    assert.equal(res.status, 403);
  });

  it('globally disabled service unavailable', async () => {
    const flight = await Service.findById(flightId);
    const prev = flight.globalStatus;
    flight.globalStatus = 'INACTIVE';
    await flight.save();

    const list = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      token: dsaAToken,
    });
    const row = list.json.data.services.find((s) => s.service.code === 'flight');
    assert.equal(row.effectiveOffered, false);
    assert.equal(row.availability.code, 'GLOBALLY_DISABLED');

    const activate = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${flightId}`,
      { token: dsaAToken, body: { isActiveByDSA: true } },
    );
    assert.equal(activate.status, 403);

    flight.globalStatus = prev;
    await flight.save();
  });

  it('suspended DSA blocks DSAAdmin access', async () => {
    await Dsa.updateOne({ _id: dsaA._id }, { $set: { status: 'SUSPENDED' } });
    const res = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      token: dsaAToken,
    });
    assert.equal(res.status, 401);
    await Dsa.updateOne({ _id: dsaA._id }, { $set: { status: 'ACTIVE' } });
    // Re-login after suspension cleared (existing token still valid if DSA active)
    const me = await httpJson(port, 'GET', '/api/dsa-admin/profile', {
      token: dsaAToken,
    });
    assert.equal(me.status, 200);
  });

  it('permission denied for service manage', async () => {
    const res = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${hotelId}`,
      { token: supportToken, body: { isActiveByDSA: false } },
    );
    assert.equal(res.status, 403);
  });

  it('APLAdmin sees DSAAdmin service-state changes', async () => {
    await httpJson(port, 'PATCH', `/api/dsa-admin/services/${hotelId}`, {
      token: dsaAToken,
      body: { isActiveByDSA: false },
    });
    const aplView = await httpJson(
      port,
      'GET',
      `/api/apl-admin/dsas/${dsaA._id}/services`,
      { token: aplToken },
    );
    assert.equal(aplView.status, 200);
    const hotel = aplView.json.data.services.find(
      (s) => s.service.code === 'hotel',
    );
    assert.equal(hotel.mapping.isActiveByDSA, false);
  });

  it('service state persists after reload', async () => {
    await httpJson(port, 'PATCH', `/api/dsa-admin/services/${flightId}`, {
      token: dsaAToken,
      body: { isActiveByDSA: true },
    });
    const first = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      token: dsaAToken,
    });
    const second = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      token: dsaAToken,
    });
    const a = first.json.data.services.find((s) => s.service.code === 'flight');
    const b = second.json.data.services.find((s) => s.service.code === 'flight');
    assert.equal(a.mapping.isActiveByDSA, true);
    assert.equal(b.mapping.isActiveByDSA, true);
  });

  it('dashboard returns tenant-scoped real stats', async () => {
    const res = await httpJson(port, 'GET', '/api/dsa-admin/dashboard', {
      token: dsaAToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.dsa.id, String(dsaA._id));
    assert.ok(res.json.data.stats.allowedByApl >= 2);
    assert.ok(!('revenue' in res.json.data.stats));
  });
});
