'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase21d';
process.env.PUBLIC_DEV_HOST_MAP = '';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('crypto');
const { connectDatabase, disconnectDatabase } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { createDsa, setDsaStatus } = require('../tenant/services/dsa.service');
const { upsertDsaServiceMapping } = require('../tenant/services/dsa-service-mapping.service');
const catalog = require('../suppliers/services/supplier-catalog.service');
const Service = require('../tenant/models/Service');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const ServiceLog = require('../common/database/models/ServiceLog');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { Booking, Payment } = require('../common/database/models/Booking');
const { config } = require('../common/config');
const { ensureMembership } = require('../customer/services/membership.service');
const { quotePaymentFee } = require('../payments/payment-method-fee');
const { changeBusPoints } = require('./services/bus-point-change.service');
const { getBookingDetail } = require('../payments/services/ops-booking.service');
const { TWO_HOURS_MS } = require('./utils/point-window');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase21d';
const stamp = Date.now();
const travelDate = '2099-11-12';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
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
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
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
            json = { raw };
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

describe('Phase 21D bus points isolated', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let hostA;
  let hostB;
  let user;
  let userToken;
  const adminMongoose = [];

  function headers(host, token) {
    return {
      'X-APL-Public-Host': host,
      'X-Forwarded-Host': host,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  before(async () => {
    if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing to run outside apl_test_phase21d');
    await connectDatabase();
    await seedMasterServices();
    server = await listen(createApp());
    port = server.address().port;
    hostA = `p21d-a-${stamp}.example.test`;
    hostB = `p21d-b-${stamp}.example.test`;
    dsaA = await createDsa({
      companyName: `P21D A ${stamp}`,
      displayName: `P21DA ${stamp}`,
      ownerName: 'Owner A',
      email: `p21da.${stamp}@example.com`,
      phone: '9000002121',
      domain: hostA,
      subdomain: `p21da${stamp}`,
    });
    dsaB = await createDsa({
      companyName: `P21D B ${stamp}`,
      displayName: `P21DB ${stamp}`,
      ownerName: 'Owner B',
      email: `p21db.${stamp}@example.com`,
      phone: '9000002122',
      domain: hostB,
      subdomain: `p21db${stamp}`,
    });
    await setDsaStatus(dsaA._id, 'ACTIVE');
    await setDsaStatus(dsaB._id, 'ACTIVE');
    const busService = await Service.findOne({ code: 'bus' });
    assert.ok(busService);
    for (const dsa of [dsaA, dsaB]) {
      await upsertDsaServiceMapping({
        dsaId: dsa._id,
        serviceId: busService._id,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }
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
        { upsert: true },
      );
      await catalog.upsertDsaSupplierAssignment(
        {
          dsaId: String(dsaA._id),
          serviceId: String(busService._id),
          supplierId: String(supplier._id),
          enabled: true,
          priority: code === 'MOCKBUS_A' ? 1 : 2,
          routingStrategy: 'PARALLEL',
        },
        { adminUserId: null, actorType: 'SYSTEM' },
      );
    }
    if (config.publicDevHostMap && typeof config.publicDevHostMap.set === 'function') {
      config.publicDevHostMap.set(hostA, dsaA.dsaCode);
      config.publicDevHostMap.set(hostB, dsaB.dsaCode);
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('Password1!', salt, 32).toString('hex');
    user = await User.create({
      name: 'Phase 21D',
      email: `p21d.${stamp}@example.com`,
      phoneNumber: '9876543210',
      passwordHash: `${salt}:${hash}`,
      currency: 'INR',
      balance: 50000,
    });
    userToken = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(userToken).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    await ensureMembership({ userId: user._id, dsaId: dsaA._id });
    await ensureMembership({ userId: user._id, dsaId: dsaB._id });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    for (const mongoose of adminMongoose) {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    }
  });

  it('books a mock bus, changes points, and records admin views and logs', async () => {
    const search = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: headers(hostA),
      body: { origin: 'Delhi', destination: 'Mumbai', travelDate },
    });
    assert.equal(search.status, 200, JSON.stringify(search.json));
    const bus = search.json.data.buses[0];
    const offer = bus.primaryOffer || bus.offers[0];
    const points = offer.boardingPoints;
    const drops = offer.droppingPoints;
    assert.equal(points.length, 5);
    assert.equal(drops.length, 5);
    assert.ok(points[0].address && points[0].landmark && points[0].time);
    const selectedSeats = ['1B'];
    const confirmPrice = {
      amount: Number(offer.price.amount) * selectedSeats.length,
      currency: offer.price.currency,
    };
    const checkout = await httpJson(port, 'POST', '/api/v1/buses/checkout', {
      headers: headers(hostA),
      body: {
        searchId: search.json.data.searchId,
        aplBusId: bus.aplBusId,
        aplOfferId: offer.aplOfferId,
        selectedSeats,
        boardingPointCode: points[0].code,
        droppingPointCode: drops[0].code,
        confirmPrice,
        contact: { email: 'p21d@example.com', phone: '9999999999' },
        travellers: [{ type: 'ADULT', title: 'Ms', firstName: 'Aisha', lastName: 'Meridian', age: 32, seat: '1B' }],
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.json));
    const priced = checkout.json.data.pricing;
    const bookPrice = { amount: priced.amount, currency: priced.currency };
    const book = await httpJson(port, 'POST', '/api/v1/buses/book', {
      headers: headers(hostA, userToken),
      body: {
        checkoutToken: checkout.json.data.checkoutToken,
        confirmPrice: bookPrice,
        payment: {
          method: 'UPI',
          upiId: 'phase21d@upi',
          amount: bookPrice.amount,
          feeAmount: 0,
          idempotencyKey: `p21d-pay-${stamp}`,
        },
      },
    });
    assert.equal(book.status, 200, JSON.stringify(book.json));
    const ref = book.json.data.aplBookingRef;
    const searchId = search.json.data.searchId;

    const list = await httpJson(port, 'GET', '/api/v1/bookings', { headers: headers(hostA, userToken) });
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const card = list.json.data.bookings.find((row) => row.bookingId === ref);
    assert.equal(card.itinerary.boardingPoint.code, points[0].code);
    assert.equal(card.itinerary.boardingPoint.address, points[0].address);
    assert.equal(card.itinerary.droppingPoint.landmark, drops[0].landmark);
    assert.equal(card.itinerary.boardingPoints.length, 5);
    assert.equal(card.itinerary.droppingPoints.length, 5);

    const detail = await httpJson(port, 'GET', `/api/v1/bookings/${ref}`, { headers: headers(hostA, userToken) });
    assert.equal(detail.json.data.itinerary.boardingPoint.name, points[0].name);
    assert.equal(detail.json.data.itinerary.pointChangeAllowed, true);

    const changed = await httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
      headers: headers(hostA, userToken),
      body: {
        bookingId: ref,
        boardingPointCode: points[1].code,
        droppingPointCode: drops[1].code,
        idempotencyKey: `p21d-change-${stamp}`,
      },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(changed.json.data.itinerary.boardingPoint.code, points[1].code);
    assert.equal(changed.json.data.itinerary.droppingPoint.code, drops[1].code);
    assert.equal(changed.json.data.itinerary.pointChanges.length, 1);
    assert.equal(changed.json.data.itinerary.pointChanges[0].oldBoarding.code, points[0].code);
    assert.equal(changed.json.data.itinerary.pointChanges[0].customerId, String(user._id));

    const replay = await httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
      headers: headers(hostA, userToken),
      body: {
        bookingId: ref,
        boardingPointCode: points[1].code,
        droppingPointCode: drops[1].code,
        idempotencyKey: `p21d-change-${stamp}`,
      },
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(replay.json.data.itinerary.pointChanges.length, 1);

    const [firstRace, secondRace] = await Promise.all([
      httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
        headers: headers(hostA, userToken),
        body: {
          bookingId: ref,
          boardingPointCode: points[2].code,
          droppingPointCode: drops[2].code,
          idempotencyKey: `p21d-race-a-${stamp}`,
        },
      }),
      httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
        headers: headers(hostA, userToken),
        body: {
          bookingId: ref,
          boardingPointCode: points[2].code,
          droppingPointCode: drops[2].code,
          idempotencyKey: `p21d-race-b-${stamp}`,
        },
      }),
    ]);
    const races = [firstRace, secondRace];
    assert.equal(races.filter((row) => row.status === 200).length, 1, JSON.stringify(races.map((row) => row.status)));
    assert.ok(races.some((row) => row.status >= 400));
    const stored = await Booking.findOne({ aplBookingRef: ref }).lean();
    assert.equal(stored.services.bus.pointChanges.length, 2);
    assert.equal(stored.services.bus.originalBoardingPoint.code, points[0].code);
    assert.equal(stored.services.bus.boardingPoint.code, points[2].code);

    const invalid = await httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
      headers: headers(hostA, userToken),
      body: {
        bookingId: ref,
        boardingPointCode: 'NOT-A-POINT',
        droppingPointCode: drops[2].code,
        idempotencyKey: `p21d-invalid-${stamp}`,
      },
    });
    assert.ok(invalid.status >= 400, JSON.stringify(invalid.json));
    assert.match(JSON.stringify(invalid.json), /Invalid boardingPointCode/);

    const otherHost = await httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
      headers: headers(hostB, userToken),
      body: {
        bookingId: ref,
        boardingPointCode: points[3].code,
        droppingPointCode: drops[3].code,
        idempotencyKey: `p21d-cross-${stamp}`,
      },
    });
    assert.equal(otherHost.status, 403, JSON.stringify(otherHost.json));

    const departure = new Date('2099-01-01T12:00:00.000Z');
    await Booking.updateOne(
      { aplBookingRef: ref },
      { $set: { 'services.bus.departureAt': departure.toISOString(), 'items.0.snapshot.departureAt': departure.toISOString() } },
    );
    const boundary = await changeBusPoints(
      {
        bookingId: ref,
        boardingPointCode: points[3].code,
        droppingPointCode: drops[3].code,
        idempotencyKey: `p21d-boundary-${stamp}`,
      },
      user,
      { tenant: { dsaId: dsaA._id }, requestId: `req-boundary-${stamp}`, now: new Date(departure.getTime() - TWO_HOURS_MS) },
    );
    assert.equal(boundary.itinerary.boardingPoint.code, points[3].code);
    await assert.rejects(
      () => changeBusPoints(
        {
          bookingId: ref,
          boardingPointCode: points[4].code,
          droppingPointCode: drops[4].code,
          idempotencyKey: `p21d-inside-${stamp}`,
        },
        user,
        { tenant: { dsaId: dsaA._id }, requestId: `req-inside-${stamp}`, now: new Date(departure.getTime() - TWO_HOURS_MS + 1) },
      ),
      /2 hours/,
    );
    await assert.rejects(
      () => changeBusPoints(
        {
          bookingId: ref,
          boardingPointCode: points[4].code,
          droppingPointCode: drops[4].code,
          idempotencyKey: `p21d-after-${stamp}`,
        },
        user,
        { tenant: { dsaId: dsaA._id }, requestId: `req-after-${stamp}`, now: new Date(departure.getTime() + 1000) },
      ),
      /2 hours/,
    );
    await Booking.updateOne(
      { aplBookingRef: ref },
      { $set: { 'services.bus.departureAt': new Date(Date.now() + 30 * 60 * 1000).toISOString() } },
    );
    const tooSoon = await httpJson(port, 'POST', '/api/v1/buses/bookings/points', {
      headers: headers(hostA, userToken),
      body: {
        bookingId: ref,
        boardingPointCode: points[4].code,
        droppingPointCode: drops[4].code,
        idempotencyKey: `p21d-http-soon-${stamp}`,
      },
    });
    assert.ok(tooSoon.status >= 400, JSON.stringify(tooSoon.json));

    const aplDetail = await getBookingDetail({ aplBookingRef: ref, audience: 'APL' });
    assert.equal(aplDetail.bus.originalBoardingPoint.code, points[0].code);
    assert.equal(aplDetail.bus.boardingPoint.code, points[3].code);
    assert.equal(aplDetail.bus.boardingPoints.length, 5);
    assert.equal(aplDetail.bus.modificationStatus, 'CHANGED');
    assert.ok(aplDetail.bus.modifiedAt);
    assert.ok(aplDetail.bus.pointChanges.length >= 3);
    const dsaDetail = await getBookingDetail({ aplBookingRef: ref, dsaScope: dsaA._id, audience: 'DSA' });
    assert.equal(dsaDetail.bus.droppingPoint.code, drops[3].code);
    await assert.rejects(
      () => getBookingDetail({ aplBookingRef: ref, dsaScope: dsaB._id, audience: 'DSA' }),
      /not found/i,
    );

    const logs = await ServiceLog.find({ searchId, businessOperation: 'POINT_CHANGE' }).lean();
    const successLog = logs.find((row) => row.stage === 'SUPPLIER_RESPONSE' && row.result?.accepted === true);
    assert.ok(successLog, 'supplier response missing');
    assert.equal(successLog.result.mock, true);
    const main = logs.find((row) => row.stage === 'INBOUND_REQUEST' && row.request?.oldBoardingPointCode === points[0].code);
    assert.ok(main);
    assert.equal(main.request.journeyId, searchId);
    assert.equal(main.request.bookingId, ref);
    const response = logs.find((row) => row.stage === 'OUTBOUND_RESPONSE' && row.result?.newBoardingPointCode === points[1].code);
    assert.ok(response);
    assert.equal(typeof response.durationMs, 'number');
    const supplierCalls = logs.filter((row) => row.stage === 'SUPPLIER_REQUEST' && row.supplierRequest?.idempotencyKey === `p21d-change-${stamp}`);
    assert.equal(supplierCalls.length, 1);

    const base = bookPrice.amount;
    assert.equal(quotePaymentFee(base, 'UPI').feeAmount, 0);
    assert.equal(quotePaymentFee(base, 'UPI').totalAmount, base);
    assert.equal(quotePaymentFee(base, 'WALLET').feeAmount, 0);
    assert.equal(quotePaymentFee(base, 'CARD').rateBps, 250);
    assert.equal(quotePaymentFee(base, 'NETBANKING').rateBps, 300);
    assert.equal(quotePaymentFee(10000, 'CARD').totalAmount, 10250);
    assert.equal(quotePaymentFee(10000, 'NETBANKING').totalAmount, 10300);
    const payment = await Payment.findOne({ bookingId: stored._id }).lean();
    assert.equal(payment.amount, base);
    assert.equal(payment.providerMeta.paymentFee.feeAmount, 0);
    assert.equal(payment.providerMeta.paymentFee.simulated, true);
    const fresh = await Booking.findOne({ aplBookingRef: ref }).lean();
    assert.equal(fresh.commercialSnapshot.paymentCharge.method, 'UPI');
    assert.equal(fresh.commercialSnapshot.paymentCharge.feeAmount, 0);
    assert.equal(fresh.commercialSnapshot.paymentCharge.provider, 'APL_MOCK_PAY');

    const tamperCheckout = await httpJson(port, 'POST', '/api/v1/buses/checkout', {
      headers: headers(hostA),
      body: {
        searchId,
        aplBusId: bus.aplBusId,
        aplOfferId: offer.aplOfferId,
        selectedSeats: ['1C'],
        boardingPointCode: points[0].code,
        droppingPointCode: drops[0].code,
        confirmPrice: bookPrice,
        contact: { email: 'p21d@example.com', phone: '9999999999' },
        travellers: [{ type: 'ADULT', title: 'Mr', firstName: 'Ravi', lastName: 'Tester', age: 30, seat: '1C' }],
      },
    });
    assert.equal(tamperCheckout.status, 200, JSON.stringify(tamperCheckout.json));
    const tamper = await httpJson(port, 'POST', '/api/v1/buses/book', {
      headers: headers(hostA, userToken),
      body: {
        checkoutToken: tamperCheckout.json.data.checkoutToken,
        confirmPrice: bookPrice,
        payment: {
          method: 'CARD',
          cardNumber: '4111111111111111',
          amount: bookPrice.amount,
          feeAmount: 0,
          idempotencyKey: `p21d-tamper-${stamp}`,
        },
      },
    });
    const cardQuote = quotePaymentFee(bookPrice.amount, 'CARD');
    assert.equal(tamper.status, 200, JSON.stringify(tamper.json));
    assert.equal(tamper.json.data.payment.amount, cardQuote.totalAmount);
    assert.equal(tamper.json.data.commercialSnapshot.paymentCharge.feeAmount, cardQuote.feeAmount);
    assert.notEqual(tamper.json.data.payment.amount, bookPrice.amount);

    const aplJourney = require('/Users/rohandalal/Developer/AplTech/APLADMIN/APLAdminBackEnd/src/suppliers/services/flight-journey.admin');
    const dsaJourney = require('/Users/rohandalal/Developer/AplTech/DSAADMIN/DSAAdminBackEnd/src/dsa-admin/services/flight-journey.admin');
    const aplOps = require('/Users/rohandalal/Developer/AplTech/APLADMIN/APLAdminBackEnd/src/payments/services/ops-booking.service');
    const dsaOps = require('/Users/rohandalal/Developer/AplTech/DSAADMIN/DSAAdminBackEnd/src/payments/services/ops-booking.service');
    const aplDb = require('/Users/rohandalal/Developer/AplTech/APLADMIN/APLAdminBackEnd/src/common/database/connection');
    const dsaDb = require('/Users/rohandalal/Developer/AplTech/DSAADMIN/DSAAdminBackEnd/src/common/database/connection');
    adminMongoose.push(require('/Users/rohandalal/Developer/AplTech/APLADMIN/APLAdminBackEnd/node_modules/mongoose'));
    adminMongoose.push(require('/Users/rohandalal/Developer/AplTech/DSAADMIN/DSAAdminBackEnd/node_modules/mongoose'));
    await aplDb.connectDatabase();
    await dsaDb.connectDatabase();
    const aplAdminDetail = await aplOps.getBookingDetail({ aplBookingRef: ref, audience: 'APL' });
    const dsaAdminDetail = await dsaOps.getBookingDetail({ aplBookingRef: ref, dsaScope: dsaA._id, audience: 'DSA' });
    assert.equal(aplAdminDetail.bus.originalBoardingPoint.code, points[0].code);
    assert.equal(aplAdminDetail.bus.boardingPoint.code, points[3].code);
    assert.equal(dsaAdminDetail.bus.pointChanges.length, aplAdminDetail.bus.pointChanges.length);
    await assert.rejects(
      () => dsaOps.getBookingDetail({ aplBookingRef: ref, dsaScope: dsaB._id, audience: 'DSA' }),
      /not found/i,
    );

    function pointOperation(detailView) {
      return detailView.operations.find((row) => row.operation === 'POINT_CHANGE');
    }
    const aplView = await aplJourney.getTravelJourney(searchId);
    const dsaView = await dsaJourney.getTravelJourney(searchId, { dsaId: String(dsaA._id) });
    for (const view of [aplView, dsaView]) {
      const operation = pointOperation(view);
      assert.ok(operation, JSON.stringify(view.operations.map((row) => row.operation)));
      const roles = operation.events.map((event) => event.role);
      assert.ok(roles.includes('Main Request'));
      assert.ok(roles.includes('Supplier Request'));
      assert.ok(roles.includes('Supplier Response'));
      assert.ok(roles.includes('Main Response'));
      const requestEvent = operation.events.find((event) => event.role === 'Main Request');
      assert.equal(requestEvent.payload.bookingId, ref);
      assert.equal(requestEvent.payload.journeyId, searchId);
      assert.ok(requestEvent.payload.oldBoardingPointCode);
      assert.ok(requestEvent.payload.boardingPointCode);
      const supplier = operation.events.find((event) => event.role === 'Supplier Response');
      assert.equal(supplier.payload.mock, true);
      assert.equal(view.summary.bookingRef, ref);
    }
    await assert.rejects(
      () => dsaJourney.getTravelJourney(searchId, { dsaId: String(dsaB._id) }),
      /not found/i,
    );
  });
});
