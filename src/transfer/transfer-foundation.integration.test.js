'use strict';

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('crypto');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../common/database/connection');
const { createApp } = require('../app');
const { seedAdminRoles } = require('../admin-auth/services/seed-roles');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { createDsa, setDsaStatus } = require('../tenant/services/dsa.service');
const {
  upsertDsaServiceMapping,
} = require('../tenant/services/dsa-service-mapping.service');
const { createAplAdminUser } = require('../apl-admin/services/apl-auth.service');
const {
  createDsaAdminUser,
} = require('../dsa-admin/services/dsa-auth.service');
const catalog = require('../suppliers/services/supplier-catalog.service');
const Service = require('../tenant/models/Service');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const ServiceLog = require('../common/database/models/ServiceLog');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { Booking } = require('../common/database/models/Booking');
const { config } = require('../common/config');
const { createRule } = require('../pricing/services/pricing-rule.service');
const { RULE_KINDS } = require('../pricing/services/pricing-engine.service');
const {
  ensureTransferActive,
} = require('./services/transfer-search.service');

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

describeDb('Phase 14B transfer foundation', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let hostA;
  let hostB;
  let transferService;
  let mockA;
  let mockB;
  let aplToken;
  let dsaAToken;
  let userToken;
  let userBToken;
  const previousDevMap = config.publicDevHostMap;
  const stamp = Date.now();

  function tenantHeaders(host, extra = {}) {
    return {
      'X-APL-Public-Host': host,
      'X-Forwarded-Host': host,
      ...extra,
    };
  }

  async function createTestUser(label) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('Password1!', salt, 32).toString('hex');
    const user = await User.create({
      name: label,
      email: `p14b.${label}.${stamp}.${crypto.randomBytes(2).toString('hex')}@example.com`.toLowerCase(),
      phoneNumber: '9876543210',
      passwordHash: `${salt}:${hash}`,
      currency: 'INR',
      balance: 50000,
    });
    const loginToken = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(loginToken).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    return { user, loginToken };
  }

  async function ensureMocks() {
    await ensureTransferActive();
    for (const code of ['MOCKXFER_A', 'MOCKXFER_B']) {
      const supplier = await Supplier.findOneAndUpdate(
        { code },
        {
          $set: {
            name: `${code} (Mock)`,
            status: 'ACTIVE',
            isMock: true,
            environments: ['TEST'],
            defaultEnvironment: 'TEST',
            credentialRef: `SUPPLIER_${code}`,
            credentialsConfigured: false,
          },
          $setOnInsert: { code },
        },
        { upsert: true, new: true },
      );
      await SupplierService.findOneAndUpdate(
        { supplierId: supplier._id, serviceId: transferService._id },
        { $set: { enabled: true, environment: null } },
        { upsert: true, new: true },
      );
      if (code === 'MOCKXFER_A') mockA = supplier;
      else mockB = supplier;
    }
  }

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    await ensureTransferActive();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    hostA = `p14b-a-${stamp}.example.test`;
    hostB = `p14b-b-${stamp}.example.test`;

    dsaA = await createDsa({
      companyName: `P14B DSA A ${stamp}`,
      displayName: `P14BA ${stamp}`,
      ownerName: 'Owner A',
      email: `p14ba.${stamp}@example.com`,
      phone: '9000001416',
      domain: hostA,
      subdomain: `p14ba${stamp}`,
    });
    dsaB = await createDsa({
      companyName: `P14B DSA B ${stamp}`,
      displayName: `P14BB ${stamp}`,
      ownerName: 'Owner B',
      email: `p14bb.${stamp}@example.com`,
      phone: '9000001417',
      domain: hostB,
      subdomain: `p14bb${stamp}`,
    });
    await setDsaStatus(dsaA._id, 'ACTIVE');
    await setDsaStatus(dsaB._id, 'ACTIVE');

    transferService = await Service.findOne({ code: 'transfer' });
    assert.ok(transferService);
    await ensureMocks();

    await upsertDsaServiceMapping({
      dsaId: dsaA._id,
      serviceId: transferService._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    await upsertDsaServiceMapping({
      dsaId: dsaB._id,
      serviceId: transferService._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });

    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId: String(dsaA._id),
        serviceId: String(transferService._id),
        supplierId: String(mockA._id),
        enabled: true,
        priority: 1,
        routingStrategy: 'PARALLEL',
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId: String(dsaA._id),
        serviceId: String(transferService._id),
        supplierId: String(mockB._id),
        enabled: true,
        priority: 2,
        routingStrategy: 'PARALLEL',
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );

    await createRule(
      {
        name: `P14B APL transfer markup ${stamp}`,
        ownerScope: 'PLATFORM',
        ruleKind: RULE_KINDS.APL_MARKUP,
        serviceCode: 'transfer',
        adjustmentType: 'PERCENTAGE',
        value: 5,
        status: 'ACTIVE',
        priority: 100,
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    await createRule(
      {
        name: `P14B APL transfer ceiling ${stamp}`,
        ownerScope: 'PLATFORM',
        ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
        serviceCode: 'transfer',
        adjustmentType: 'PERCENTAGE',
        value: 10,
        status: 'ACTIVE',
        priority: 100,
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    await createRule(
      {
        name: `P14B DSA A transfer markup ${stamp}`,
        ownerScope: 'DSA',
        dsaId: String(dsaA._id),
        ruleKind: RULE_KINDS.DSA_MARKUP,
        serviceCode: 'transfer',
        adjustmentType: 'PERCENTAGE',
        value: 3,
        status: 'ACTIVE',
        priority: 100,
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );

    if (config.publicDevHostMap && typeof config.publicDevHostMap.set === 'function') {
      config.publicDevHostMap.set(hostA, dsaA.dsaCode);
      config.publicDevHostMap.set(hostB, dsaB.dsaCode);
    }

    const aplEmail = `p14b.apl.${stamp}@example.com`;
    await createAplAdminUser({
      name: 'P14B APL',
      email: aplEmail,
      password: 'Phase14Bpl!',
      roleCode: 'SUPER_ADMIN',
    });
    const aplLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password: 'Phase14Bpl!' },
    });
    aplToken = aplLogin.json.data.token;

    await createDsaAdminUser({
      dsaId: dsaA._id,
      name: 'P14B DSA A Admin',
      email: `p14b.dsaa.${stamp}@example.com`,
      password: 'Phase14Bdsa!',
      roleCode: 'DSA_OWNER',
    });
    const dsaALogin = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: {
        email: `p14b.dsaa.${stamp}@example.com`,
        password: 'Phase14Bdsa!',
      },
    });
    dsaAToken = dsaALogin.json.data.token;

    userToken = (await createTestUser('custA')).loginToken;
    userBToken = (await createTestUser('custB')).loginToken;
  });

  after(async () => {
    if (config.publicDevHostMap && typeof config.publicDevHostMap.delete === 'function') {
      if (hostA) config.publicDevHostMap.delete(hostA);
      if (hostB) config.publicDevHostMap.delete(hostB);
    } else {
      config.publicDevHostMap = previousDevMap;
    }
    if (server) await new Promise((r) => server.close(r));
    await disconnectDatabase();
  });

  const searchBody = {
    pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
    dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
    pickupDateTime: '2099-09-10T14:30',
    passengers: 2,
  };

  it('rejects revoked transfer service', async () => {
    await upsertDsaServiceMapping({
      dsaId: dsaB._id,
      serviceId: transferService._id,
      isAllowedByAPL: false,
      isActiveByDSA: true,
    });
    const res = await httpJson(port, 'POST', '/api/v1/transfers/search', {
      headers: tenantHeaders(hostB),
      body: searchBody,
    });
    assert.ok(res.status >= 400);
    await upsertDsaServiceMapping({
      dsaId: dsaB._id,
      serviceId: transferService._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
  });

  it('fans out to both mock transfer suppliers and consolidates SEDAN', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/transfers/search', {
      headers: tenantHeaders(hostA),
      body: searchBody,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = res.json.data;
    assert.ok(data.searchId);
    assert.ok(data.transfers.length >= 2);
    const suppliers = (data.suppliers || []).map((s) => s.supplier).sort();
    assert.deepEqual(suppliers, ['MOCKXFER_A', 'MOCKXFER_B']);
    const sedan = data.transfers.find((t) => t.vehicleCategory === 'SEDAN');
    assert.ok(sedan);
    assert.ok(sedan.offers.length >= 2);
    assert.match(sedan.aplTransferId, /^APL-XFER-/);
    assert.ok(!sedan.offers[0].commercialSnapshot);
    assert.ok(!sedan.offers[0].supplierPrice);
  });

  it('isolates supplier failure', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/transfers/search', {
      headers: tenantHeaders(hostA, {
        'x-simulate-supplier-failure': 'MOCKXFER_A',
      }),
      body: searchBody,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const a = res.json.data.suppliers.find((s) => s.supplier === 'MOCKXFER_A');
    const b = res.json.data.suppliers.find((s) => s.supplier === 'MOCKXFER_B');
    assert.ok(a && a.status !== 'SUCCESS');
    assert.equal(b.status, 'SUCCESS');
  });

  it('enforces supplier assignment', async () => {
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId: String(dsaB._id),
        serviceId: String(transferService._id),
        supplierId: String(mockA._id),
        enabled: true,
        priority: 1,
        routingStrategy: 'PARALLEL',
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    const res = await httpJson(port, 'POST', '/api/v1/transfers/search', {
      headers: tenantHeaders(hostB),
      body: searchBody,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(
      (res.json.data.suppliers || []).map((s) => s.supplier),
      ['MOCKXFER_A'],
    );
  });

  it('checkout → pay → book → cancel with ownership guards', async () => {
    const search = await httpJson(port, 'POST', '/api/v1/transfers/search', {
      headers: tenantHeaders(hostA),
      body: searchBody,
    });
    assert.equal(search.status, 200);
    const transfer = search.json.data.transfers[0];
    const offer = transfer.primaryOffer || transfer.offers[0];
    const confirmPrice = {
      amount: Number(offer.price.amount),
      currency: offer.price.currency,
    };

    const checkout = await httpJson(port, 'POST', '/api/v1/transfers/checkout', {
      headers: tenantHeaders(hostA),
      body: {
        searchId: search.json.data.searchId,
        aplTransferId: transfer.aplTransferId,
        aplOfferId: offer.aplOfferId,
        confirmPrice,
        contact: { email: 'xfer@example.com', phone: '9999999999' },
        travellers: [
          { type: 'ADULT', title: 'Mr', firstName: 'Lead', lastName: 'Guest' },
        ],
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.json));

    const book = await httpJson(port, 'POST', '/api/v1/transfers/book', {
      headers: tenantHeaders(hostA, { Authorization: `Bearer ${userToken}` }),
      body: {
        checkoutToken: checkout.json.data.checkoutToken,
        confirmPrice,
        payment: {
          method: 'CARD',
          cardNumber: '4111111111111111',
          idempotencyKey: `p14b-pay-${stamp}`,
        },
      },
    });
    assert.equal(book.status, 200, JSON.stringify(book.json));
    const ref = book.json.data.aplBookingRef;
    assert.equal(book.json.data.productType, 'TRANSFER');

    const replay = await httpJson(port, 'POST', '/api/v1/transfers/book', {
      headers: tenantHeaders(hostA, { Authorization: `Bearer ${userToken}` }),
      body: {
        checkoutToken: checkout.json.data.checkoutToken,
        confirmPrice,
        payment: {
          method: 'CARD',
          cardNumber: '4111111111111111',
          idempotencyKey: `p14b-pay-${stamp}`,
        },
      },
    });
    assert.equal(replay.json.data.aplBookingRef, ref);
    assert.equal(replay.json.data.idempotentReplay, true);

    const denied = await httpJson(port, 'POST', '/api/v1/transfers/bookings/cancel', {
      headers: tenantHeaders(hostA, { Authorization: `Bearer ${userBToken}` }),
      body: { bookingId: ref },
    });
    assert.ok(denied.status >= 400);

    const cancel = await httpJson(port, 'POST', '/api/v1/transfers/bookings/cancel', {
      headers: tenantHeaders(hostA, { Authorization: `Bearer ${userToken}` }),
      body: {
        bookingId: ref,
        reason: 'Phase 14B mock cancel',
        idempotencyKey: `p14b-cancel-${ref}`,
      },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.json));

    const doc = await Booking.findOne({ aplBookingRef: ref }).lean();
    assert.equal(doc.productType, 'TRANSFER');
    assert.equal(String(doc.dsaId), String(dsaA._id));

    const logs = await ServiceLog.countDocuments({ service: 'TRANSFER' });
    assert.ok(logs > 0);

    const apl = await httpJson(port, 'GET', '/api/apl-admin/bookings?service=TRANSFER', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    assert.equal(apl.status, 200);
    const dsa = await httpJson(port, 'GET', '/api/dsa-admin/bookings', {
      headers: { Authorization: `Bearer ${dsaAToken}` },
    });
    assert.equal(dsa.status, 200);
  });
});
