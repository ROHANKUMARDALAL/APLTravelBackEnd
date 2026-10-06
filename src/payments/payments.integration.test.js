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
const Service = require('../tenant/models/Service');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { Booking, Payment } = require('../common/database/models/Booking');
const CancellationRequest = require('./models/CancellationRequest');
const Refund = require('./models/Refund');
const { config } = require('../common/config');

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

describeDb('Phase 13 payments cancellation refunds', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let hostA;
  let hostB;
  let aplToken;
  let dsaAToken;
  let dsaBToken;
  const previousDevMap = config.publicDevHostMap;
  const dsaIds = [];
  const userIds = [];
  const bookingRefs = [];

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
      email: `p13.${label}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}@example.com`.toLowerCase(),
      phoneNumber: '9876543210',
      passwordHash: `${salt}:${hash}`,
      currency: 'INR',
      balance: 50000,
    });
    userIds.push(String(user._id));
    const loginToken = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(loginToken).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    return { user, loginToken };
  }

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    const stamp = Date.now();
    hostA = `p13-a-${stamp}.example.test`;
    hostB = `p13-b-${stamp}.example.test`;

    dsaA = await createDsa({
      companyName: `P13 DSA A ${stamp}`,
      displayName: `P13A ${stamp}`,
      ownerName: 'Owner A',
      email: `p13a.${stamp}@example.com`,
      phone: '9000000013',
      domain: hostA,
      subdomain: `p13a${stamp}`,
    });
    dsaB = await createDsa({
      companyName: `P13 DSA B ${stamp}`,
      displayName: `P13B ${stamp}`,
      ownerName: 'Owner B',
      email: `p13b.${stamp}@example.com`,
      phone: '9000000014',
      domain: hostB,
      subdomain: `p13b${stamp}`,
    });
    dsaIds.push(String(dsaA._id), String(dsaB._id));
    await setDsaStatus(dsaA._id, 'ACTIVE');
    await setDsaStatus(dsaB._id, 'ACTIVE');

    const flight = await Service.findOne({ code: 'flight' });
    assert.ok(flight);
    for (const dsa of [dsaA, dsaB]) {
      await upsertDsaServiceMapping({
        dsaId: dsa._id,
        serviceId: flight._id,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }

    if (config.publicDevHostMap && typeof config.publicDevHostMap.set === 'function') {
      config.publicDevHostMap.set(hostA, dsaA.dsaCode);
      config.publicDevHostMap.set(hostB, dsaB.dsaCode);
    }

    const aplEmail = `p13.apl.${stamp}@example.com`;
    await createAplAdminUser({
      name: 'P13 APL',
      email: aplEmail,
      password: 'Phase13Apl!',
      roleCode: 'SUPER_ADMIN',
    });
    const aplLogin = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password: 'Phase13Apl!' },
    });
    aplToken = aplLogin.json.data.token;

    await createDsaAdminUser({
      dsaId: dsaA._id,
      name: 'P13 DSA A Admin',
      email: `p13.dsaa.${stamp}@example.com`,
      password: 'Phase13Dsa!',
      roleCode: 'DSA_OWNER',
    });
    const dsaALogin = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: {
        email: `p13.dsaa.${stamp}@example.com`,
        password: 'Phase13Dsa!',
      },
    });
    dsaAToken = dsaALogin.json.data.token;

    await createDsaAdminUser({
      dsaId: dsaB._id,
      name: 'P13 DSA B Admin',
      email: `p13.dsab.${stamp}@example.com`,
      password: 'Phase13Dsa!',
      roleCode: 'DSA_OWNER',
    });
    const dsaBLogin = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: {
        email: `p13.dsab.${stamp}@example.com`,
        password: 'Phase13Dsa!',
      },
    });
    dsaBToken = dsaBLogin.json.data.token;
  });

  after(async () => {
    if (config.publicDevHostMap && typeof config.publicDevHostMap.delete === 'function') {
      if (hostA) config.publicDevHostMap.delete(hostA);
      if (hostB) config.publicDevHostMap.delete(hostB);
    } else {
      config.publicDevHostMap = previousDevMap;
    }
    if (bookingRefs.length) {
      const bookings = await Booking.find({
        aplBookingRef: { $in: bookingRefs },
      });
      const ids = bookings.map((b) => b._id);
      await Payment.deleteMany({ bookingId: { $in: ids } });
      await CancellationRequest.deleteMany({ bookingId: { $in: ids } });
      await Refund.deleteMany({ bookingId: { $in: ids } });
      await Booking.deleteMany({ _id: { $in: ids } });
    }
    if (userIds.length) {
      await LoginSession.deleteMany({ userId: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
  });

  async function searchCheckoutBook({
    host,
    token,
    payment = { method: 'UPI', upiId: 'phase13@upi' },
    confirmOverride,
    idempotencyKey,
    simulateBookingFailure,
  }) {
    const search = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(host),
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-12-15',
        adults: 1,
      },
    });
    assert.equal(search.status, 200, JSON.stringify(search.json));
    const flightRow = search.json.data.flights[0];
    assert.ok(flightRow);
    const fare = flightRow.flightFareData[0];
    assert.ok(fare);
    const amount = fare.price.amount;
    const currency = fare.price.currency;

    const checkout = await httpJson(port, 'POST', '/api/v1/flights/checkout', {
      headers: tenantHeaders(host),
      body: {
        searchId: search.json.data.searchId,
        aplFlightId: flightRow.aplFlightId,
        aplFareId: fare.aplFareId,
        contact: { email: 'p13@example.com', phone: '9999999999' },
        travellers: [
          {
            type: 'ADULT',
            title: 'Mr',
            firstName: 'Phase',
            lastName: 'Thirteen',
          },
        ],
        confirmPrice: { amount, currency },
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.json));
    const checkoutToken = checkout.json.data.checkoutToken;
    const chargedAmount = checkout.json.data.pricing.amount;
    const chargedCurrency = checkout.json.data.pricing.currency;

    const book = await httpJson(port, 'POST', '/api/v1/flights/book', {
      headers: tenantHeaders(host, { Authorization: `Bearer ${token}` }),
      body: {
        checkoutToken,
        payment,
        confirmPrice: confirmOverride || {
          amount: chargedAmount,
          currency: chargedCurrency,
        },
        idempotencyKey,
        simulateBookingFailure,
      },
    });
    return {
      search,
      checkout,
      book,
      amount: chargedAmount,
      currency: chargedCurrency,
      checkoutToken,
    };
  }

  it('1+2+4) server snapshot amount; tampered amount rejected; success stored', async () => {
    const { loginToken } = await createTestUser('amount');
    const bad = await searchCheckoutBook({
      host: hostA,
      token: loginToken,
      confirmOverride: { amount: 100, currency: 'INR' },
    });
    assert.equal(bad.book.status, 400);
    assert.match(
      String(
        bad.book.json?.error?.ErrorMessage ||
          bad.book.json?.error?.message ||
          '',
      ),
      /mismatch|Price/i,
    );

    const good = await searchCheckoutBook({
      host: hostA,
      token: loginToken,
    });
    assert.equal(good.book.status, 200, JSON.stringify(good.book.json));
    assert.equal(good.book.json.data.paymentStatus, 'SUCCESS');
    assert.equal(good.book.json.data.bookingStatus, 'CONFIRMED');
    assert.equal(good.book.json.data.payment.amount, good.amount);
    assert.equal(String(good.book.json.data.dsaId), String(dsaA._id));
    bookingRefs.push(good.book.json.data.aplBookingRef);

    const booking = await Booking.findOne({
      aplBookingRef: good.book.json.data.aplBookingRef,
    });
    const pay = await Payment.findOne({ bookingId: booking._id });
    assert.equal(pay.status, 'SUCCESS');
    assert.ok(!JSON.stringify(pay.toObject()).includes('@upi'));
  });

  it('3+7) duplicate book is idempotent', async () => {
    const { loginToken } = await createTestUser('idem');
    const first = await searchCheckoutBook({
      host: hostA,
      token: loginToken,
    });
    assert.equal(first.book.status, 200, JSON.stringify(first.book.json));
    const ref = first.book.json.data.aplBookingRef;
    bookingRefs.push(ref);

    const replay = await httpJson(port, 'POST', '/api/v1/flights/book', {
      headers: tenantHeaders(hostA, {
        Authorization: `Bearer ${loginToken}`,
      }),
      body: {
        checkoutToken: first.checkoutToken,
        payment: { method: 'UPI', upiId: 'phase13@upi' },
        confirmPrice: { amount: first.amount, currency: first.currency },
      },
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(replay.json.data.aplBookingRef, ref);
    assert.equal(replay.json.data.idempotentReplay, true);
    assert.equal(
      await Booking.countDocuments({ checkoutToken: first.checkoutToken }),
      1,
    );
  });

  it('5) payment failure is stored', async () => {
    const { loginToken } = await createTestUser('fail');
    const fail = await searchCheckoutBook({
      host: hostA,
      token: loginToken,
      payment: { method: 'CARD', cardNumber: '4111111111110000' },
      idempotencyKey: `fail-${crypto.randomBytes(3).toString('hex')}`,
    });
    assert.equal(fail.book.status, 402);
    const failedPay = await Payment.findOne({
      checkoutToken: fail.checkoutToken,
    }).sort({ createdAt: -1 });
    assert.ok(failedPay);
    assert.equal(failedPay.status, 'FAILED');
  });

  it('6) payment success + booking failure is recoverable', async () => {
    const { loginToken } = await createTestUser('pbf');
    const out = await searchCheckoutBook({
      host: hostA,
      token: loginToken,
      simulateBookingFailure: true,
      idempotencyKey: `pbf-${crypto.randomBytes(3).toString('hex')}`,
    });
    assert.equal(out.book.status, 400);
    assert.match(
      String(
        out.book.json?.error?.ErrorMessage ||
          out.book.json?.error?.message ||
          '',
      ),
      /booking confirmation failed/i,
    );
    const pay = await Payment.findOne({
      checkoutToken: out.checkoutToken,
    }).sort({ createdAt: -1 });
    assert.equal(pay.status, 'SUCCESS');
    assert.equal(pay.bookingConfirmStatus, 'FAILED');
    assert.equal(pay.needsAttention, true);
    assert.ok(!pay.bookingId);
  });

  it('8+9+10+11+15) cancel ownership, snapshot refund, idempotent cancel', async () => {
    const customerA = await createTestUser('cxl-a');
    const customerB = await createTestUser('cxl-b');
    const booked = await searchCheckoutBook({
      host: hostA,
      token: customerA.loginToken,
    });
    assert.equal(booked.book.status, 200);
    const ref = booked.book.json.data.aplBookingRef;
    bookingRefs.push(ref);

    const other = await httpJson(port, 'POST', '/api/v1/flights/bookings/cancel', {
      headers: tenantHeaders(hostA, {
        Authorization: `Bearer ${customerB.loginToken}`,
      }),
      body: { bookingId: ref, reason: 'not mine' },
    });
    assert.ok(other.status === 404 || other.status === 403);

    const cancel1 = await httpJson(
      port,
      'POST',
      '/api/v1/flights/bookings/cancel',
      {
        headers: tenantHeaders(hostA, {
          Authorization: `Bearer ${customerA.loginToken}`,
        }),
        body: {
          bookingId: ref,
          reason: 'change of plans',
          idempotencyKey: `cx-${ref}`,
        },
      },
    );
    assert.equal(cancel1.status, 200, JSON.stringify(cancel1.json));
    assert.equal(cancel1.json.data.bookingStatus, 'CANCELLED');
    assert.equal(cancel1.json.data.refund.status, 'SUCCESS');
    assert.equal(cancel1.json.data.refund.approvedAmount, booked.amount);

    const booking = await Booking.findOne({ aplBookingRef: ref });
    const refund = await Refund.findOne({ bookingId: booking._id });
    assert.equal(refund.breakdown.source, 'booking.commercialSnapshot');

    const cancel2 = await httpJson(
      port,
      'POST',
      '/api/v1/flights/bookings/cancel',
      {
        headers: tenantHeaders(hostA, {
          Authorization: `Bearer ${customerA.loginToken}`,
        }),
        body: { bookingId: ref, idempotencyKey: `cx-${ref}` },
      },
    );
    assert.equal(cancel2.status, 200);
    assert.equal(
      cancel2.json.data.cancellation.cancellationRef,
      cancel1.json.data.cancellation.cancellationRef,
    );
    assert.equal(
      await CancellationRequest.countDocuments({ bookingId: booking._id }),
      1,
    );
    assert.equal(await Refund.countDocuments({ bookingId: booking._id }), 1);
  });

  it('13+14+16+17) DSA tenancy isolation + APLAdmin inspect', async () => {
    const { loginToken } = await createTestUser('tenant');
    const aBook = await searchCheckoutBook({
      host: hostA,
      token: loginToken,
    });
    assert.equal(aBook.book.status, 200);
    const refA = aBook.book.json.data.aplBookingRef;
    bookingRefs.push(refA);

    const dsaAList = await httpJson(port, 'GET', '/api/dsa-admin/bookings', {
      headers: { Authorization: `Bearer ${dsaAToken}` },
    });
    assert.equal(dsaAList.status, 200, JSON.stringify(dsaAList.json));
    assert.ok(dsaAList.json.data.items.some((b) => b.aplBookingRef === refA));

    const dsaBList = await httpJson(port, 'GET', '/api/dsa-admin/bookings', {
      headers: { Authorization: `Bearer ${dsaBToken}` },
    });
    assert.equal(dsaBList.status, 200);
    assert.ok(!dsaBList.json.data.items.some((b) => b.aplBookingRef === refA));

    const dsaBDetail = await httpJson(
      port,
      'GET',
      `/api/dsa-admin/bookings/${refA}`,
      { headers: { Authorization: `Bearer ${dsaBToken}` } },
    );
    assert.equal(dsaBDetail.status, 404);

    const dsaADetail = await httpJson(
      port,
      'GET',
      `/api/dsa-admin/bookings/${refA}`,
      { headers: { Authorization: `Bearer ${dsaAToken}` } },
    );
    assert.equal(dsaADetail.status, 200);
    assert.equal(dsaADetail.json.data.booking.commercial.aplMarkup, undefined);
    assert.equal(dsaADetail.json.data.booking.commercial.supplierNet, undefined);

    const aplDetail = await httpJson(
      port,
      'GET',
      `/api/apl-admin/bookings/${refA}`,
      { headers: { Authorization: `Bearer ${aplToken}` } },
    );
    assert.equal(aplDetail.status, 200, JSON.stringify(aplDetail.json));
    assert.ok(aplDetail.json.data.booking.payment);
    assert.ok(aplDetail.json.data.booking.commercial?.finalPrice);

    const aplPays = await httpJson(port, 'GET', '/api/apl-admin/payments', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    assert.equal(aplPays.status, 200);
    assert.ok(
      aplPays.json.data.items.some((p) => p.booking?.aplBookingRef === refA),
    );
  });

  it('18) card/cvv secrets not persisted', async () => {
    const docs = await Payment.find({})
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    for (const doc of docs) {
      const raw = JSON.stringify(doc);
      assert.ok(!/"cvv"/i.test(raw));
      assert.ok(!/"cardNumber"/i.test(raw));
      assert.ok(!/4111111111111111/.test(raw));
    }
  });
});
