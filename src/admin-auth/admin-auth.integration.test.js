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
const { seedAdminRoles } = require('./services/seed-roles');
const {
  createAplAdminUser,
  TOKEN_PREFIX: APL_PREFIX,
  hashToken: aplHashToken,
} = require('../apl-admin/services/apl-auth.service');
const {
  createDsaAdminUser,
  TOKEN_PREFIX: DSA_PREFIX,
} = require('../dsa-admin/services/dsa-auth.service');
const { createDsa } = require('../tenant/services/dsa.service');
const AplAdminUser = require('../apl-admin/models/AplAdminUser');
const AplAdminSession = require('../apl-admin/models/AplAdminSession');
const DsaAdminUser = require('../dsa-admin/models/DsaAdminUser');
const DsaAdminSession = require('../dsa-admin/models/DsaAdminSession');
const Dsa = require('../tenant/models/Dsa');
const { Permission, ROLE_SCOPE } = require('./permissions');
const AdminRole = require('./models/AdminRole');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
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
        res.on('data', (chunk) => {
          raw += chunk;
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

describeDb('admin auth & RBAC integration', () => {
  let server;
  let port;
  let aplEmail;
  let dsaEmail;
  let dsaId;
  const password = 'TestPass123!';
  const createdDsaIds = [];
  const createdAplEmails = [];
  const createdDsaEmails = [];

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    aplEmail = `apl.auth.${Date.now()}@example.com`;
    await createAplAdminUser({
      name: 'APL Tester',
      email: aplEmail,
      password,
      roleCode: 'SUPER_ADMIN',
    });
    createdAplEmails.push(aplEmail);

    const dsa = await createDsa({
      companyName: 'Auth Test DSA',
      displayName: 'Auth Test',
      ownerName: 'Owner',
      email: `dsa.tenant.${Date.now()}@example.com`,
      phone: '+919999999991',
      status: 'ACTIVE',
    });
    dsaId = String(dsa._id);
    createdDsaIds.push(dsaId);

    dsaEmail = `dsa.auth.${Date.now()}@example.com`;
    await createDsaAdminUser({
      dsaId,
      name: 'DSA Tester',
      email: dsaEmail,
      password,
      roleCode: 'DSA_OWNER',
    });
    createdDsaEmails.push(dsaEmail);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const aplUsers = await AplAdminUser.find({
      email: { $in: createdAplEmails },
    });
    await AplAdminSession.deleteMany({
      userId: { $in: aplUsers.map((u) => u._id) },
    });
    await AplAdminUser.deleteMany({ email: { $in: createdAplEmails } });

    const dsaUsers = await DsaAdminUser.find({
      email: { $in: createdDsaEmails },
    });
    await DsaAdminSession.deleteMany({
      userId: { $in: dsaUsers.map((u) => u._id) },
    });
    await DsaAdminUser.deleteMany({ email: { $in: createdDsaEmails } });
    await Dsa.deleteMany({ _id: { $in: createdDsaIds } });
    await disconnectDatabase();
  });

  it('valid APLAdmin login', async () => {
    const res = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.match(res.json.data.token, new RegExp(`^${APL_PREFIX}`));
    assert.equal(res.json.data.user.email, aplEmail);
    assert.ok(!('passwordHash' in res.json.data.user));
  });

  it('invalid APLAdmin login', async () => {
    const res = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
  });

  it('valid DSAAdmin login', async () => {
    const res = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password },
    });
    assert.equal(res.status, 200);
    assert.match(res.json.data.token, new RegExp(`^${DSA_PREFIX}`));
    assert.equal(res.json.data.user.dsaId, dsaId);
  });

  it('invalid DSAAdmin login', async () => {
    const res = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password: 'bad' },
    });
    assert.equal(res.status, 401);
  });

  it('expired token rejected', async () => {
    const login = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    const token = login.json.data.token;
    await AplAdminSession.updateOne(
      { tokenHash: aplHashToken(token) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const me = await httpJson(port, 'GET', '/api/apl-admin/auth/me', { token });
    assert.equal(me.status, 401);
  });

  it('revoked token rejected', async () => {
    const login = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    const token = login.json.data.token;
    await httpJson(port, 'POST', '/api/apl-admin/auth/logout', { token });
    const me = await httpJson(port, 'GET', '/api/apl-admin/auth/me', { token });
    assert.equal(me.status, 401);
  });

  it('APL token rejected by DSA middleware', async () => {
    const login = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    const me = await httpJson(port, 'GET', '/api/dsa-admin/auth/me', {
      token: login.json.data.token,
    });
    assert.equal(me.status, 401);
  });

  it('DSA token rejected by APL middleware', async () => {
    const login = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password },
    });
    const me = await httpJson(port, 'GET', '/api/apl-admin/auth/me', {
      token: login.json.data.token,
    });
    assert.equal(me.status, 401);
  });

  it('disabled admin rejected', async () => {
    const email = `apl.disabled.${Date.now()}@example.com`;
    await createAplAdminUser({
      name: 'Disabled',
      email,
      password,
      roleCode: 'SUPPORT',
    });
    createdAplEmails.push(email);
    await AplAdminUser.updateOne({ email }, { $set: { status: 'DISABLED' } });
    const res = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email, password },
    });
    assert.equal(res.status, 401);
  });

  it('inactive DSA rejected', async () => {
    await Dsa.updateOne({ _id: dsaId }, { $set: { status: 'SUSPENDED' } });
    const res = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password },
    });
    assert.equal(res.status, 401);
    await Dsa.updateOne({ _id: dsaId }, { $set: { status: 'ACTIVE' } });
  });

  it('permission allowed and denied', async () => {
    const supportEmail = `apl.support.${Date.now()}@example.com`;
    await createAplAdminUser({
      name: 'Support',
      email: supportEmail,
      password,
      roleCode: 'SUPPORT',
    });
    createdAplEmails.push(supportEmail);

    const supportLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: supportEmail, password },
    });
    const allowed = await httpJson(port, 'GET', '/api/apl-admin/services', {
      token: supportLogin.json.data.token,
    });
    assert.equal(allowed.status, 200);

    const role = await AdminRole.findOne({
      scope: ROLE_SCOPE.APL,
      code: 'SUPPORT',
    }).lean();
    assert.equal(role.permissions.includes(Permission.SERVICE_VIEW), true);
    assert.equal(role.permissions.includes(Permission.AUDIT_VIEW), false);

    const accountsEmail = `apl.accounts.${Date.now()}@example.com`;
    await createAplAdminUser({
      name: 'Accounts',
      email: accountsEmail,
      password,
      roleCode: 'ACCOUNTS',
    });
    createdAplEmails.push(accountsEmail);
    const accountsLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: accountsEmail, password },
    });
    const forbidden = await httpJson(port, 'GET', '/api/apl-admin/services', {
      token: accountsLogin.json.data.token,
    });
    assert.equal(forbidden.status, 403);
  });

  it('DSA tenant context comes from authenticated session', async () => {
    const login = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password },
    });
    const me = await httpJson(port, 'GET', '/api/dsa-admin/auth/me', {
      token: login.json.data.token,
    });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.tenant.dsaId, dsaId);
    assert.equal(me.json.data.tenant.source, 'session');
  });

  it('client-supplied foreign dsaId cannot change tenant context', async () => {
    const login = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: dsaEmail, password },
    });
    const me = await httpJson(
      port,
      'GET',
      '/api/dsa-admin/auth/me?dsaId=000000000000000000000099',
      { token: login.json.data.token },
    );
    assert.equal(me.status, 200);
    assert.equal(me.json.data.tenant.dsaId, dsaId);
    assert.notEqual(me.json.data.tenant.dsaId, '000000000000000000000099');
  });

  it('logout revokes session', async () => {
    const login = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password },
    });
    const token = login.json.data.token;
    const out = await httpJson(port, 'POST', '/api/apl-admin/auth/logout', {
      token,
    });
    assert.equal(out.status, 200);
    assert.equal(out.json.data.revoked, true);
    const session = await AplAdminSession.findOne({
      tokenHash: aplHashToken(token),
    });
    assert.ok(session.revokedAt);
  });

  it('Phase 3 services endpoint requires APL auth', async () => {
    const anon = await httpJson(port, 'GET', '/api/apl-admin/services');
    assert.equal(anon.status, 401);
  });

  it('health and B2C auth mount remain available', async () => {
    const health = await httpJson(port, 'GET', '/health');
    assert.equal(health.status, 200);
    const captcha = await httpJson(port, 'GET', '/api/v1/auth/captcha');
    assert.ok([200, 500, 503].includes(captcha.status));
  });
});
