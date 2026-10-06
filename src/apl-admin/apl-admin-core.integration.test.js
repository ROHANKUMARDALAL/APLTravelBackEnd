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
const {
  createAplAdminUser,
} = require('./services/apl-auth.service');
const AplAdminUser = require('./models/AplAdminUser');
const AplAdminSession = require('./models/AplAdminSession');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const DsaService = require('../tenant/models/DsaService');

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

describeDb('APLAdmin Phase 5 core APIs', () => {
  let server;
  let port;
  let superToken;
  let accountsToken;
  let createdDsaId;
  let flightServiceId;
  const password = 'Phase5Pass123!';
  const emails = [];

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    const superEmail = `p5.super.${Date.now()}@example.com`;
    emails.push(superEmail);
    await createAplAdminUser({
      name: 'P5 Super',
      email: superEmail,
      password,
      roleCode: 'SUPER_ADMIN',
    });
    const login = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: superEmail, password },
    });
    superToken = login.json.data.token;

    const accountsEmail = `p5.accounts.${Date.now()}@example.com`;
    emails.push(accountsEmail);
    await createAplAdminUser({
      name: 'P5 Accounts',
      email: accountsEmail,
      password,
      roleCode: 'ACCOUNTS',
    });
    const accountsLogin = await httpJson(
      port,
      'POST',
      '/api/apl-admin/auth/login',
      { body: { email: accountsEmail, password } },
    );
    accountsToken = accountsLogin.json.data.token;

    const flight = await Service.findOne({ code: 'flight' }).lean();
    flightServiceId = String(flight._id);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (createdDsaId) {
      await DsaService.deleteMany({ dsaId: createdDsaId });
      await Dsa.deleteOne({ _id: createdDsaId });
    }
    await Service.deleteMany({ code: /^p5test/ });
    const users = await AplAdminUser.find({ email: { $in: emails } });
    await AplAdminSession.deleteMany({
      userId: { $in: users.map((u) => u._id) },
    });
    await AplAdminUser.deleteMany({ email: { $in: emails } });
    await disconnectDatabase();
  });

  it('authorized DSA creation', async () => {
    const res = await httpJson(port, 'POST', '/api/apl-admin/dsas', {
      token: superToken,
      body: {
        companyName: 'Phase5 Travel Co',
        displayName: 'Phase5 Travel',
        ownerName: 'Owner Five',
        email: `p5.dsa.${Date.now()}@example.com`,
        phone: '+919800000005',
        status: 'ACTIVE',
      },
    });
    assert.equal(res.status, 200);
    assert.match(res.json.data.dsa.dsaCode, /^APL-DSA-\d+$/);
    createdDsaId = res.json.data.dsa.id;
  });

  it('unauthorized creation denied', async () => {
    const res = await httpJson(port, 'POST', '/api/apl-admin/dsas', {
      body: {
        companyName: 'Nope',
        ownerName: 'Nope',
        email: 'nope@example.com',
        phone: '+910000000000',
      },
    });
    assert.equal(res.status, 401);
  });

  it('permission denial for DSA create', async () => {
    const res = await httpJson(port, 'POST', '/api/apl-admin/dsas', {
      token: accountsToken,
      body: {
        companyName: 'Denied Co',
        ownerName: 'Denied',
        email: `denied.${Date.now()}@example.com`,
        phone: '+910000000001',
      },
    });
    assert.equal(res.status, 403);
  });

  it('DSA list and detail', async () => {
    const list = await httpJson(port, 'GET', '/api/apl-admin/dsas?page=1', {
      token: superToken,
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.data.items));

    const detail = await httpJson(
      port,
      'GET',
      `/api/apl-admin/dsas/${createdDsaId}`,
      { token: superToken },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.dsa.id, createdDsaId);
  });

  it('DSA update', async () => {
    const res = await httpJson(port, 'PATCH', `/api/apl-admin/dsas/${createdDsaId}`, {
      token: superToken,
      body: { displayName: 'Phase5 Travel Updated' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.dsa.displayName, 'Phase5 Travel Updated');
  });

  it('DSA status change', async () => {
    const suspended = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${createdDsaId}/status`,
      { token: superToken, body: { status: 'SUSPENDED' } },
    );
    assert.equal(suspended.status, 200);
    assert.equal(suspended.json.data.dsa.status, 'SUSPENDED');

    const active = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${createdDsaId}/status`,
      { token: superToken, body: { status: 'ACTIVE' } },
    );
    assert.equal(active.status, 200);
    assert.equal(active.json.data.dsa.status, 'ACTIVE');
  });

  it('master service management and duplicate code prevention', async () => {
    const code = `p5test${Date.now()}`;
    const created = await httpJson(port, 'POST', '/api/apl-admin/services', {
      token: superToken,
      body: {
        code,
        name: 'P5 Test Service',
        globalStatus: 'ACTIVE',
        displayOrder: 50,
      },
    });
    assert.equal(created.status, 200);

    const dup = await httpJson(port, 'POST', '/api/apl-admin/services', {
      token: superToken,
      body: { code, name: 'Dup' },
    });
    assert.equal(dup.status, 400);

    const patched = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/services/${created.json.data.service.id}`,
      {
        token: superToken,
        body: { globalStatus: 'INACTIVE' },
      },
    );
    assert.equal(patched.status, 200);
    assert.equal(patched.json.data.service.globalStatus, 'INACTIVE');
  });

  it('service assignment, duplicate mapping, revocation, offer rule', async () => {
    const assign = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${createdDsaId}/services/${flightServiceId}`,
      { token: superToken, body: { isAllowedByAPL: true } },
    );
    assert.equal(assign.status, 200);
    assert.equal(assign.json.data.mapping.isAllowedByAPL, true);

    // Re-assign is upsert, not duplicate error
    const again = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${createdDsaId}/services/${flightServiceId}`,
      { token: superToken, body: { isAllowedByAPL: true } },
    );
    assert.equal(again.status, 200);

    // Effective offer false until DSA activates
    let offer = await httpJson(
      port,
      'GET',
      `/api/apl-admin/service-offer/evaluate?dsaId=${createdDsaId}&serviceCode=flight`,
      { token: superToken },
    );
    assert.equal(offer.status, 200);
    assert.equal(offer.json.data.offered, false);

    await DsaService.updateOne(
      { dsaId: createdDsaId, serviceId: flightServiceId },
      { $set: { isActiveByDSA: true } },
    );
    offer = await httpJson(
      port,
      'GET',
      `/api/apl-admin/service-offer/evaluate?dsaId=${createdDsaId}&serviceCode=flight`,
      { token: superToken },
    );
    assert.equal(offer.json.data.offered, true);

    const revoke = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${createdDsaId}/services/${flightServiceId}`,
      { token: superToken, body: { isAllowedByAPL: false } },
    );
    assert.equal(revoke.status, 200);
    assert.equal(revoke.json.data.mapping.isAllowedByAPL, false);
    assert.equal(revoke.json.data.mapping.isActiveByDSA, false);

    offer = await httpJson(
      port,
      'GET',
      `/api/apl-admin/service-offer/evaluate?dsaId=${createdDsaId}&serviceCode=flight`,
      { token: superToken },
    );
    assert.equal(offer.json.data.offered, false);

    // Inactive DSA
    await httpJson(port, 'PATCH', `/api/apl-admin/dsas/${createdDsaId}/status`, {
      token: superToken,
      body: { status: 'SUSPENDED' },
    });
    await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${createdDsaId}/services/${flightServiceId}`,
      { token: superToken, body: { isAllowedByAPL: true } },
    );
    await DsaService.updateOne(
      { dsaId: createdDsaId, serviceId: flightServiceId },
      { $set: { isActiveByDSA: true } },
    );
    offer = await httpJson(
      port,
      'GET',
      `/api/apl-admin/service-offer/evaluate?dsaId=${createdDsaId}&serviceCode=flight`,
      { token: superToken },
    );
    assert.equal(offer.json.data.offered, false);

    await httpJson(port, 'PATCH', `/api/apl-admin/dsas/${createdDsaId}/status`, {
      token: superToken,
      body: { status: 'ACTIVE' },
    });

    // Globally inactive service
    const flight = await Service.findById(flightServiceId);
    const previous = flight.globalStatus;
    flight.globalStatus = 'INACTIVE';
    await flight.save();
    offer = await httpJson(
      port,
      'GET',
      `/api/apl-admin/service-offer/evaluate?dsaId=${createdDsaId}&serviceCode=flight`,
      { token: superToken },
    );
    assert.equal(offer.json.data.offered, false);
    flight.globalStatus = previous;
    await flight.save();
  });

  it('dashboard returns real stats', async () => {
    const res = await httpJson(port, 'GET', '/api/apl-admin/dashboard', {
      token: superToken,
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.data.stats.totalDsas >= 1);
    assert.ok(Array.isArray(res.json.data.recentDsas));
  });
});
