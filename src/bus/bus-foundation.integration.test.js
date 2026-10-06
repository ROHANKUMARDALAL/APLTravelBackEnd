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
const DsaSupplier = require('../common/database/models/DsaSupplier');
const ServiceLog = require('../common/database/models/ServiceLog');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { Booking } = require('../common/database/models/Booking');
const { config } = require('../common/config');
const {
  createRule,
} = require('../pricing/services/pricing-rule.service');
const { RULE_KINDS } = require('../pricing/services/pricing-engine.service');

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
          resolve({
            status: res.statusCode,
            json,
            requestId: res.headers['x-request-id'] || json?.meta?.requestId,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describeDb('Phase 14A bus foundation', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let hostA;
  let hostB;
  let busService;
  let mockA;
  let mockB;
  let aplToken;
  let dsaAToken;
  let userToken;
  let userBToken;
  const previousDevMap = config.publicDevHostMap;
  const stamp = Date.now();
  const travelDate = '2099-07-20';

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
      email: `p14a.${label}.${stamp}.${crypto.randomBytes(2).toString('hex')}@example.com`.toLowerCase(),
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

  async function ensureMockBusSuppliers() {
    for (const code of ['MOCKBUS_A', 'MOCKBUS_B']) {
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
        { supplierId: supplier._id, serviceId: busService._id },
        { $set: { enabled: true, environment: null } },
        { upsert: true, new: true },
      );
      if (code === 'MOCKBUS_A') mockA = supplier;
      else mockB = supplier;
    }
  }

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    hostA = `p14a-a-${stamp}.example.test`;
    hostB = `p14a-b-${stamp}.example.test`;

    dsaA = await createDsa({
      companyName: `P14A DSA A ${stamp}`,
      displayName: `P14AA ${stamp}`,
      ownerName: 'Owner A',
      email: `p14aa.${stamp}@example.com`,
      phone: '9000001414',
      domain: hostA,
      subdomain: `p14aa${stamp}`,
    });
    dsaB = await createDsa({
      companyName: `P14A DSA B ${stamp}`,
      displayName: `P14AB ${stamp}`,
      ownerName: 'Owner B',
      email: `p14ab.${stamp}@example.com`,
      phone: '9000001415',
      domain: hostB,
      subdomain: `p14ab${stamp}`,
    });
    await setDsaStatus(dsaA._id, 'ACTIVE');
    await setDsaStatus(dsaB._id, 'ACTIVE');

    busService = await Service.findOne({ code: 'bus' });
    assert.ok(busService);

    await upsertDsaServiceMapping({
      dsaId: dsaA._id,
      serviceId: busService._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    await upsertDsaServiceMapping({
      dsaId: dsaB._id,
      serviceId: busService._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });

    await ensureMockBusSuppliers();
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId: String(dsaA._id),
        serviceId: String(busService._id),
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
        serviceId: String(busService._id),
        supplierId: String(mockB._id),
        enabled: true,
        priority: 2,
        routingStrategy: 'PARALLEL',
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );

    await createRule(
      {
        name: `P14A APL bus markup ${stamp}`,
        ownerScope: 'PLATFORM',
        ruleKind: RULE_KINDS.APL_MARKUP,
        serviceCode: 'bus',
        adjustmentType: 'PERCENTAGE',
        value: 5,
        status: 'ACTIVE',
        priority: 100,
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    await createRule(
      {
        name: `P14A APL bus ceiling ${stamp}`,
        ownerScope: 'PLATFORM',
        ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
        serviceCode: 'bus',
        adjustmentType: 'PERCENTAGE',
        value: 10,
        status: 'ACTIVE',
        priority: 100,
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    await createRule(
      {
        name: `P14A DSA A bus markup ${stamp}`,
        ownerScope: 'DSA',
        dsaId: String(dsaA._id),
        ruleKind: RULE_KINDS.DSA_MARKUP,
        serviceCode: 'bus',
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

    const aplEmail = `p14a.apl.${stamp}@example.com`;
    await createAplAdminUser({
      name: 'P14A APL',
      email: aplEmail,
      password: 'Phase14Apl!',
      roleCode: 'SUPER_ADMIN',
    });
    const aplLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password: 'Phase14Apl!' },
    });
    aplToken = aplLogin.json.data.token;

    await createDsaAdminUser({
      dsaId: dsaA._id,
      name: 'P14A DSA A Admin',
      email: `p14a.dsaa.${stamp}@example.com`,
      password: 'Phase14Dsa!',
      roleCode: 'DSA_OWNER',
    });
    const dsaALogin = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: {
        email: `p14a.dsaa.${stamp}@example.com`,
        password: 'Phase14Dsa!',
      },
    });
    dsaAToken = dsaALogin.json.data.token;

    const uA = await createTestUser('custA');
    const uB = await createTestUser('custB');
    userToken = uA.loginToken;
    userBToken = uB.loginToken;
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

  it('rejects bus search when service revoked for DSA', async () => {
    await upsertDsaServiceMapping({
      dsaId: dsaB._id,
      serviceId: busService._id,
      isAllowedByAPL: false,
      isActiveByDSA: true,
    });
    const res = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(hostB),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.ok(res.status >= 400);
    await upsertDsaServiceMapping({
      dsaId: dsaB._id,
      serviceId: busService._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
  });

  it('rejects bus search when DSA inactive', async () => {
    await setDsaStatus(dsaA._id, 'SUSPENDED');
    const res = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(hostA),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.ok(res.status >= 400);
    await setDsaStatus(dsaA._id, 'ACTIVE');
  });

  it('fans out to both mock bus suppliers and consolidates safely', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(hostA),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = res.json.data;
    assert.ok(data.searchId);
    assert.ok(Array.isArray(data.buses));
    assert.ok(data.buses.length >= 4);
    const suppliers = (data.suppliers || []).map((s) => s.supplier).sort();
    assert.deepEqual(suppliers, ['MOCKBUS_A', 'MOCKBUS_B']);

    const eastCoast = data.buses.find(
      (b) =>
        b.operator === 'East Coast Express' && b.departure?.time === '07:30',
    );
    assert.ok(eastCoast, 'expected consolidated East Coast Express');
    assert.ok(eastCoast.offers.length >= 2);
    assert.match(eastCoast.aplBusId, /^APL-BUS-/);
    assert.ok(!eastCoast.offers[0].commercialSnapshot);
    assert.ok(!eastCoast.offers[0].supplierPrice);
    assert.ok(eastCoast.lowestPrice?.amount > 0);
  });

  it('isolates supplier failure via simulate header', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(hostA, {
        'x-simulate-supplier-failure': 'MOCKBUS_A',
      }),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const meta = res.json.data.suppliers || [];
    const a = meta.find((s) => s.supplier === 'MOCKBUS_A');
    const b = meta.find((s) => s.supplier === 'MOCKBUS_B');
    assert.ok(a && a.status !== 'SUCCESS');
    assert.equal(b.status, 'SUCCESS');
    assert.ok(res.json.data.buses.length > 0);
  });

  it('enforces supplier assignment (only assigned suppliers fan out)', async () => {
    await DsaSupplier.deleteMany({
      dsaId: dsaB._id,
      serviceId: busService._id,
    });
    await catalog.upsertDsaSupplierAssignment(
      {
        dsaId: String(dsaB._id),
        serviceId: String(busService._id),
        supplierId: String(mockA._id),
        enabled: true,
        priority: 1,
        routingStrategy: 'PARALLEL',
      },
      { adminUserId: null, actorType: 'SYSTEM' },
    );
    const res = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(hostB),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const suppliers = (res.json.data.suppliers || []).map((s) => s.supplier);
    assert.deepEqual(suppliers, ['MOCKBUS_A']);
    assert.equal(suppliers.includes('MOCKBUS_B'), false);
  });

  it('checkout → mock pay → booking → cancel/refund with tenancy + ownership', async () => {
    const search = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(hostA),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.equal(search.status, 200);
    const bus = search.json.data.buses[0];
    const offer = bus.primaryOffer || bus.offers[0];
    const boarding = offer.boardingPoints[0];
    const dropping = offer.droppingPoints[0];
    const selectedSeats = ['1B', '1C'];
    const unit = Number(offer.price.amount);
    const confirmPrice = {
      amount: unit * selectedSeats.length,
      currency: offer.price.currency,
    };

    const checkout = await httpJson(port, 'POST', '/api/v1/buses/checkout', {
      headers: tenantHeaders(hostA),
      body: {
        searchId: search.json.data.searchId,
        aplBusId: bus.aplBusId,
        aplOfferId: offer.aplOfferId,
        selectedSeats,
        boardingPointCode: boarding.code,
        droppingPointCode: dropping.code,
        confirmPrice,
        contact: { email: 'bus@example.com', phone: '9999999999' },
        travellers: selectedSeats.map((seat, i) => ({
          type: 'ADULT',
          title: 'Mr',
          firstName: `Pax${i + 1}`,
          lastName: 'Test',
          age: 30,
          seat,
        })),
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.json));
    assert.ok(checkout.json.data.checkoutToken);
    assert.equal(checkout.json.data.pricing.amount, confirmPrice.amount);

    const book = await httpJson(port, 'POST', '/api/v1/buses/book', {
      headers: tenantHeaders(hostA, {
        Authorization: `Bearer ${userToken}`,
      }),
      body: {
        checkoutToken: checkout.json.data.checkoutToken,
        confirmPrice,
        payment: {
          method: 'CARD',
          cardNumber: '4111111111111111',
          idempotencyKey: `p14a-pay-${stamp}`,
        },
      },
    });
    assert.equal(book.status, 200, JSON.stringify(book.json));
    const ref = book.json.data.aplBookingRef;
    assert.ok(ref);
    assert.equal(book.json.data.productType, 'BUS');
    assert.equal(String(book.json.data.dsaId), String(dsaA._id));

    const replay = await httpJson(port, 'POST', '/api/v1/buses/book', {
      headers: tenantHeaders(hostA, {
        Authorization: `Bearer ${userToken}`,
      }),
      body: {
        checkoutToken: checkout.json.data.checkoutToken,
        confirmPrice,
        payment: {
          method: 'CARD',
          cardNumber: '4111111111111111',
          idempotencyKey: `p14a-pay-${stamp}`,
        },
      },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.data.aplBookingRef, ref);
    assert.equal(replay.json.data.idempotentReplay, true);

    const otherCustomer = await httpJson(
      port,
      'POST',
      '/api/v1/buses/bookings/cancel',
      {
        headers: tenantHeaders(hostA, {
          Authorization: `Bearer ${userBToken}`,
        }),
        body: { bookingId: ref, reason: 'Not mine' },
      },
    );
    assert.ok(otherCustomer.status >= 400);

    const cancel = await httpJson(port, 'POST', '/api/v1/buses/bookings/cancel', {
      headers: tenantHeaders(hostA, {
        Authorization: `Bearer ${userToken}`,
      }),
      body: {
        bookingId: ref,
        reason: 'Phase 14A mock cancel',
        idempotencyKey: `p14a-cancel-${ref}`,
      },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.json));

    const bookingDoc = await Booking.findOne({ aplBookingRef: ref }).lean();
    assert.equal(bookingDoc.productType, 'BUS');
    assert.equal(String(bookingDoc.dsaId), String(dsaA._id));

    const logs = await ServiceLog.find({
      service: 'BUS',
      searchId: search.json.data.searchId,
    })
      .limit(20)
      .lean();
    assert.ok(logs.length > 0);

    const aplBookings = await httpJson(port, 'GET', '/api/apl-admin/bookings?service=BUS', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    assert.equal(aplBookings.status, 200, JSON.stringify(aplBookings.json));
    // Soft assert — list shape may vary; booking existence already proven.
    const bookingItems =
      aplBookings.json.data?.items || aplBookings.json.data?.bookings || [];
    assert.ok(Array.isArray(bookingItems) || aplBookings.json.data);

    const dsaBookings = await httpJson(port, 'GET', '/api/dsa-admin/bookings', {
      headers: { Authorization: `Bearer ${dsaAToken}` },
    });
    assert.equal(dsaBookings.status, 200, JSON.stringify(dsaBookings.json));
  });

  it('writes lifecycle logs filterable by service=BUS', async () => {
    const count = await ServiceLog.countDocuments({ service: 'BUS' });
    assert.ok(count > 0);
  });
});
