'use strict';

/**
 * Phase 15F/15G — three-backend E2E on one MongoDB.
 * APLAdminBackEnd + DSAAdminBackEnd + APLTravelBackEnd (B2C only).
 */

require('dotenv').config();
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../../common/database/connection');
const { createApp: createB2cApp } = require('../../app');
const { seedAdminRoles } = require('../../admin-auth/services/seed-roles');
const { seedMasterServices } = require('./seed-master-services');
const { createAplAdminUser } = require('../../apl-admin/services/apl-auth.service');
const Service = require('../models/Service');
const DsaService = require('../models/DsaService');
const { isServiceOffered } = require('@apl/shared-domain');
const Dsa = require('@apl/shared-domain/models/Dsa');

const aplRoot = path.resolve(__dirname, '../../../../APLAdminBackEnd');
const dsaRoot = path.resolve(__dirname, '../../../../DSAAdminBackEnd');
const { createApp: createAplApp } = require(path.join(aplRoot, 'src/app.js'));
const { createApp: createDsaApp } = require(path.join(dsaRoot, 'src/app.js'));
const aplDb = require(path.join(aplRoot, 'src/common/database/connection.js'));
const dsaDb = require(path.join(dsaRoot, 'src/common/database/connection.js'));

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function httpJson(port, method, pathName, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
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

describeDb('Phase 15F/15G three-backend shared-Mongo hierarchy', () => {
  let apl;
  let dsaBe;
  let b2c;
  let aplToken;
  let dsaToken;
  let dsaId;
  let dsaCode;
  let host;
  const stamp = Date.now();
  const aplEmail = `p15g.apl.${stamp}@example.test`;
  const aplPass = 'P15gAplPass123!';

  before(async () => {
    await connectDatabase();
    await aplDb.connectDatabase();
    await dsaDb.connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    await createAplAdminUser({
      name: 'P15G APL',
      email: aplEmail,
      password: aplPass,
      roleCode: 'SUPER_ADMIN',
    });
    apl = await listen(createAplApp());
    dsaBe = await listen(createDsaApp());
    b2c = await listen(createB2cApp());
  });

  after(async () => {
    if (apl?.server) await new Promise((r) => apl.server.close(r));
    if (dsaBe?.server) await new Promise((r) => dsaBe.server.close(r));
    if (b2c?.server) await new Promise((r) => b2c.server.close(r));
    await Promise.all([
      disconnectDatabase().catch(() => {}),
      aplDb.disconnectDatabase().catch(() => {}),
      dsaDb.disconnectDatabase().catch(() => {}),
    ]);
  });

  it('B2C production app does not expose admin namespaces', async () => {
    const a = await httpJson(b2c.port, 'GET', '/api/apl-admin/foundation');
    const d = await httpJson(b2c.port, 'GET', '/api/dsa-admin/foundation');
    assert.equal(a.status, 404);
    assert.equal(d.status, 404);
  });

  it('APLAdmin creates DSA, allows all services, provisions DSAAdmin', async () => {
    const login = await httpJson(apl.port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password: aplPass },
    });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    aplToken = login.json.data.token;

    host = `e2e-full-${stamp}.localhost`;
    const created = await httpJson(apl.port, 'POST', '/api/apl-admin/dsas', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: {
        companyName: `E2E Full Platform ${stamp}`,
        displayName: 'E2E Full Platform Travel',
        ownerName: 'E2E Owner',
        email: `e2e.full.${stamp}@example.test`,
        phone: '+919999000015',
        domain: host,
        subdomain: `e2e-full-${stamp}`,
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    dsaId = created.json.data.dsa.id;
    dsaCode = created.json.data.dsa.dsaCode;
    assert.match(String(dsaCode), /^APL-DSA-\d+/);

    const services = await httpJson(apl.port, 'GET', '/api/apl-admin/services', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    const list = services.json.data.services || services.json.data;
    const byCode = {};
    for (const s of list) byCode[s.code] = s;
    for (const code of ['flight', 'hotel', 'bus', 'transfer']) {
      assert.ok(byCode[code], code);
      const patch = await httpJson(
        apl.port,
        'PATCH',
        `/api/apl-admin/dsas/${dsaId}/services/${byCode[code].id}`,
        {
          headers: { Authorization: `Bearer ${aplToken}` },
          body: { isAllowedByAPL: true },
        },
      );
      assert.equal(patch.status, 200, JSON.stringify(patch.json));
    }

    const provision = await httpJson(
      apl.port,
      'POST',
      `/api/apl-admin/dsas/${dsaId}/admins`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: {
          email: `e2e.dsaadmin.${stamp}@example.test`,
          name: 'E2E DSA Admin',
        },
      },
    );
    assert.equal(provision.status, 200, JSON.stringify(provision.json));
    const temp = provision.json.data.temporaryPassword;
    assert.ok(temp);

    const dsaLogin = await httpJson(dsaBe.port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: `e2e.dsaadmin.${stamp}@example.test`, password: temp },
    });
    assert.equal(dsaLogin.status, 200, JSON.stringify(dsaLogin.json));
    dsaToken = dsaLogin.json.data.token;
  });

  it('DSAAdmin activates services; client dsaId spoof ignored; B2C offer true', async () => {
    const me = await httpJson(
      dsaBe.port,
      'GET',
      '/api/dsa-admin/auth/me?dsaId=000000000000000000000099',
      { headers: { Authorization: `Bearer ${dsaToken}` } },
    );
    assert.equal(me.status, 200);
    assert.equal(String(me.json.data.tenant.dsaId), String(dsaId));

    const catalogue = await httpJson(dsaBe.port, 'GET', '/api/dsa-admin/services', {
      headers: { Authorization: `Bearer ${dsaToken}` },
    });
    assert.equal(catalogue.status, 200);
    const rows = catalogue.json.data.services || catalogue.json.data;
    for (const row of rows) {
      if (!['flight', 'hotel', 'bus', 'transfer'].includes(row.service?.code || row.code)) {
        continue;
      }
      const id = row.service?.id || row.serviceId || row.id;
      const patch = await httpJson(
        dsaBe.port,
        'PATCH',
        `/api/dsa-admin/services/${id}`,
        {
          headers: { Authorization: `Bearer ${dsaToken}` },
          body: { isActiveByDSA: true },
        },
      );
      assert.equal(patch.status, 200, JSON.stringify(patch.json));
    }

    const flight = await Service.findOne({ code: 'flight' }).lean();
    const mapping = await DsaService.findOne({
      dsaId,
      serviceId: flight._id,
    }).lean();
    const dsaDoc = await Dsa.findById(dsaId).lean();
    assert.equal(isServiceOffered({ dsa: dsaDoc, service: flight, mapping }), true);

    const site = await httpJson(b2c.port, 'GET', '/api/v1/public/site/config', {
      headers: {
        'X-APL-Public-Host': host,
        'X-Forwarded-Host': host,
      },
    });
    assert.equal(site.status, 200, JSON.stringify(site.json));
    const offered = site.json.data.services || site.json.data.offeredServices || [];
    const codes = offered.map((s) => s.code || s);
    assert.ok(codes.includes('flight') || JSON.stringify(site.json).includes('flight'));
  });

  it('APL revoke Bus → DSA cannot reactivate → B2C rejects Bus search', async () => {
    const bus = await Service.findOne({ code: 'bus' }).lean();
    const revoke = await httpJson(
      apl.port,
      'PATCH',
      `/api/apl-admin/dsas/${dsaId}/services/${bus._id}`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: { isAllowedByAPL: false },
      },
    );
    assert.equal(revoke.status, 200);

    const reactivate = await httpJson(
      dsaBe.port,
      'PATCH',
      `/api/dsa-admin/services/${bus._id}`,
      {
        headers: { Authorization: `Bearer ${dsaToken}` },
        body: { isActiveByDSA: true },
      },
    );
    assert.ok(reactivate.status >= 400, JSON.stringify(reactivate.json));

    const search = await httpJson(b2c.port, 'POST', '/api/v1/buses/search', {
      headers: {
        'X-APL-Public-Host': host,
        'X-Forwarded-Host': host,
        'Content-Type': 'application/json',
      },
      body: {
        origin: { city: 'Delhi' },
        destination: { city: 'Jaipur' },
        travelDate: '2099-09-01',
      },
    });
    assert.ok(search.status === 403 || search.status === 404, JSON.stringify(search.json));

    await httpJson(
      apl.port,
      'PATCH',
      `/api/apl-admin/dsas/${dsaId}/services/${bus._id}`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: { isAllowedByAPL: true },
      },
    );
  });

  it('APL suspend DSA blocks DSAAdmin login and B2C public; restore recovers', async () => {
    const sus = await httpJson(apl.port, 'PATCH', `/api/apl-admin/dsas/${dsaId}/status`, {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: { status: 'SUSPENDED' },
    });
    assert.equal(sus.status, 200, JSON.stringify(sus.json));

    const profile = await httpJson(dsaBe.port, 'GET', '/api/dsa-admin/profile', {
      headers: { Authorization: `Bearer ${dsaToken}` },
    });
    assert.ok(profile.status === 401 || profile.status === 403);

    const site = await httpJson(b2c.port, 'GET', '/api/v1/public/site/config', {
      headers: { 'X-APL-Public-Host': host, 'X-Forwarded-Host': host },
    });
    assert.ok(site.status === 403 || site.status === 404);

    const act = await httpJson(apl.port, 'PATCH', `/api/apl-admin/dsas/${dsaId}/status`, {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: { status: 'ACTIVE' },
    });
    assert.equal(act.status, 200);
  });
});
