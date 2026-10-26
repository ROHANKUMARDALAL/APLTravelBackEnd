'use strict';

/**
 * Isolated Phase 17H flight booking journey.
 * Refuses to run unless MONGODB_URI points at 127.0.0.1:27018.
 */
process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_flight17';
process.env.PUBLIC_DEV_HOST_MAP = 'phase17h.localhost=APL-DSA-1701,other17h.localhost=APL-DSA-1702';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const DsaService = require('../tenant/models/DsaService');
const PricingRule = require('../pricing/models/PricingRule');
const Coupon = require('../pricing/models/Coupon');
const CheckoutSession = require('../common/database/models/CheckoutSession');
const ServiceLog = require('../common/database/models/ServiceLog');
const { Booking, Payment } = require('../common/database/models/Booking');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const DsaSupplier = require('../common/database/models/DsaSupplier');

const HOST = 'phase17h.localhost';
const OTHER = 'other17h.localhost';

function assertIsolatedUri() {
  const uri = String(process.env.APL_TEST_MONGODB_URI || '');
  if (!uri.startsWith('mongodb://127.0.0.1:27018/apl_test_flight17')) {
    throw new Error('Refusing to run outside the isolated flight test database');
  }
  if (process.env.APL_ALLOW_TEST_DB !== '1') {
    throw new Error('Refusing to run without the isolated test database flag');
  }
}

async function json(server, method, path, { body, token, host = HOST } = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-apl-public-host': host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload };
}

function captchaAnswer(image) {
  const svg = Buffer.from(String(image).split(',')[1], 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<])<\/text>/g)].map((match) => match[1]).join('');
}

async function signup(server, email) {
  const captcha = await json(server, 'GET', '/api/v1/auth/captcha');
  assert.equal(captcha.status, 200);
  const answer = captchaAnswer(captcha.payload.data.image);
  const created = await json(server, 'POST', '/api/v1/auth/signup', {
    body: {
      name: 'Phase Test',
      email,
      phoneNumber: '9990001111',
      password: 'Test-pass-17h',
      currency: 'INR',
      captchaId: captcha.payload.data.captchaId,
      captchaAnswer: answer,
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.data.loginToken;
}

describe('phase 17H isolated flight booking', () => {
  let server;
  let token;
  let dsaId;

  before(async () => {
    assertIsolatedUri();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    const flight = await Service.findOne({ code: 'flight' });
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-1701',
      companyName: 'Phase 17H Holidays',
      displayName: 'Phase 17H Holidays',
      ownerName: 'Phase Owner',
      email: 'owner-17h@example.test',
      phone: '9990001701',
      subdomain: 'phase17h',
      status: 'ACTIVE',
    });
    dsaId = String(dsa._id);
    await DsaService.create({
      dsaId: dsa._id,
      serviceId: flight._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    for (const [index, code] of ['TBO', 'TRIPJACK', 'KAFILA'].entries()) {
      const supplier = await Supplier.findOneAndUpdate(
        { code },
        {
          $set: {
            name: `${code} (Mock)`,
            status: 'ACTIVE',
            isMock: true,
            environments: ['TEST'],
            defaultEnvironment: 'TEST',
          },
        },
        { upsert: true, new: true },
      );
      await SupplierService.findOneAndUpdate(
        { supplierId: supplier._id, serviceId: flight._id },
        { $set: { enabled: true, environment: 'TEST' } },
        { upsert: true },
      );
      await DsaSupplier.create({
        dsaId: dsa._id,
        serviceId: flight._id,
        supplierId: supplier._id,
        enabled: true,
        priority: index + 1,
        routingStrategy: 'PARALLEL',
      });
    }
    const other = await Dsa.create({
      dsaCode: 'APL-DSA-1702',
      companyName: 'Other 17H',
      displayName: 'Other 17H',
      ownerName: 'Other Owner',
      email: 'other-17h@example.test',
      phone: '9990001702',
      subdomain: 'other17h',
      status: 'ACTIVE',
    });
    await DsaService.create({
      dsaId: other._id,
      serviceId: flight._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    await PricingRule.create({
      name: 'DSA flight markup',
      ownerScope: 'DSA',
      dsaId: dsa._id,
      ruleKind: 'DSA_MARKUP',
      serviceCode: 'flight',
      adjustmentType: 'PERCENTAGE',
      value: 4,
      status: 'ACTIVE',
    });
    await Coupon.create({
      dsaId: dsa._id,
      serviceCode: 'flight',
      code: 'SAVE10',
      name: 'Ten percent',
      adjustmentType: 'PERCENTAGE',
      value: 10,
      maxAmount: 50,
      exclusive: false,
      status: 'ACTIVE',
    });
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    token = await signup(server, 'flyer-17h@example.test');
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('books a connecting mock flight with SSR, rejects a tampered price, and stays tenant scoped', async () => {
    const airports = await json(server, 'GET', '/api/v1/flights/airports?query=delhi');
    assert.equal(airports.status, 200);
    assert.ok(airports.payload.data.airports.some((row) => row.iata === 'DEL'));

    const search = await json(server, 'POST', '/api/v1/flights/search', {
      token,
      body: {
        journeyType: 'ONE_WAY',
        origin: 'DEL',
        destination: 'BLR',
        departureDate: '2026-11-20',
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'ECONOMY',
      },
    });
    assert.equal(search.status, 200, JSON.stringify(search.payload.error || search.payload));
    const flights = search.payload.data.flights;
    const connecting = flights.find((row) => (row.segments || []).length > 1 || row.stops === 1);
    const nonstop = flights.find((row) => (row.segments || []).length === 1 && !row.stops);
    assert.ok(connecting, 'connecting flight missing');
    assert.ok(nonstop, 'nonstop flight missing');

    const blockedSsr = await json(server, 'POST', '/api/v1/flights/ssr', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: connecting.flightFareData?.[0]?.aplFareId || connecting.lowestFare?.aplFareId,
      },
    });
    assert.equal(blockedSsr.status, 400);

    const quote = await json(server, 'POST', '/api/v1/flights/fare-quote', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: connecting.flightFareData?.[0]?.aplFareId || connecting.lowestFare?.aplFareId,
      },
    });
    assert.equal(quote.status, 200, JSON.stringify(quote.payload));
    assert.equal(quote.payload.data.status, 'AVAILABLE');
    assert.equal(quote.payload.data.priceChanged, false);
    assert.ok(quote.payload.data.fareRules.cancellation);

    const changed = await json(server, 'POST', '/api/v1/flights/fare-quote', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: quote.payload.data.aplFareId,
        simulatePriceChange: true,
      },
    });
    assert.equal(changed.payload.data.status, 'PRICE_CHANGED');
    assert.ok(changed.payload.data.price.amount > changed.payload.data.previousPrice.amount);

    const expired = await json(server, 'POST', '/api/v1/flights/fare-quote', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: quote.payload.data.aplFareId,
        expired: true,
      },
    });
    assert.equal(expired.status, 400);

    const restored = await json(server, 'POST', '/api/v1/flights/fare-quote', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: quote.payload.data.aplFareId,
        acceptPriceChange: true,
      },
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.payload.error || restored.payload));
    assert.equal(restored.payload.data.status, 'AVAILABLE');

    const ssr = await json(server, 'POST', '/api/v1/flights/ssr', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: quote.payload.data.aplFareId,
      },
    });
    assert.equal(ssr.status, 200);
    assert.ok(ssr.payload.data.segments.length >= 2);
    const ssrAgain = await json(server, 'POST', '/api/v1/flights/ssr', {
      token,
      body: {
        searchId: search.payload.data.searchId,
        aplFlightId: connecting.aplFlightId,
        aplFareId: quote.payload.data.aplFareId,
      },
    });
    assert.equal(ssrAgain.status, 200);
    assert.equal(ssrAgain.payload.data.idempotentReplay, true);
    const segmentKey = ssr.payload.data.segments[0].segmentKey;
    assert.ok(ssr.payload.data.segments[0].seats.some((seat) => seat.status === 'OCCUPIED'));

    const travellers = [{
      type: 'ADULT',
      title: 'Mr',
      firstName: 'Aman',
      lastName: 'Tester',
      gender: 'MALE',
      dateOfBirth: '1990-01-15',
      nationality: 'IN',
      passengerKey: 'p1',
    }];
    const contact = { email: 'flyer-17h@example.test', phone: '9990001111' };
    const lookup = {
      searchId: search.payload.data.searchId,
      aplFlightId: connecting.aplFlightId,
      aplFareId: quote.payload.data.aplFareId,
    };
    const addOns = {
      seats: [{ code: '12A', passengerKey: 'p1', segmentKey }],
      meals: [{ code: 'VGML', passengerKey: 'p1', segmentKey }],
      baggage: [],
    };

    const tampered = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns,
        confirmPrice: { amount: 1, currency: 'INR' },
        couponCode: 'SAVE10',
      },
    });
    assert.equal(tampered.status, 400);
    const required = tampered.payload.error.details.find((row) => row.requiredAmount);
    assert.ok(required.requiredAmount > 1);

    const occupied = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns: { seats: [{ code: '12B', passengerKey: 'p1', segmentKey }], meals: [], baggage: [] },
        confirmPrice: { amount: required.requiredAmount, currency: 'INR' },
      },
    });
    assert.equal(occupied.status, 400);

    const checkout = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns,
        confirmPrice: { amount: required.requiredAmount, currency: 'INR' },
        couponCode: 'SAVE10',
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.payload));
    assert.equal(checkout.payload.data.pricing.amount, required.requiredAmount);

    const session = await CheckoutSession.findOne({ checkoutToken: checkout.payload.data.checkoutToken }).lean();
    assert.equal(String(session.dsaId), dsaId);
    assert.equal(session.travellers[0].firstName, 'Aman');
    assert.ok(session.offerSnapshot.addOns.some((row) => row.code === '12A' && row.passengerKey === 'p1'));
    assert.equal(session.commercialSnapshot.coupon.code, 'SAVE10');
    assert.ok(session.commercialSnapshot.coupon.amount <= 50);
    assert.ok(session.commercialSnapshot.dsaMarkup.amount >= session.commercialSnapshot.coupon.amount);

    const unblocked = await json(server, 'POST', '/api/v1/flights/book', {
      token,
      body: {
        checkoutToken: checkout.payload.data.checkoutToken,
        confirmPrice: { amount: required.requiredAmount, currency: 'INR' },
        payment: { method: 'CARD', cardNumber: '4111111111114242' },
      },
    });
    assert.notEqual(unblocked.status, 200);

    const fareBlock = await json(server, 'POST', '/api/v1/flights/block', {
      token,
      body: { checkoutToken: checkout.payload.data.checkoutToken },
    });
    assert.equal(fareBlock.status, 200, JSON.stringify(fareBlock.payload));
    assert.equal(fareBlock.payload.data.holdSupported, false);

    const declined = await json(server, 'POST', '/api/v1/flights/book', {
      token,
      body: {
        checkoutToken: checkout.payload.data.checkoutToken,
        confirmPrice: { amount: required.requiredAmount, currency: 'INR' },
        payment: { method: 'CARD', cardNumber: '4111111111110000' },
      },
    });
    assert.notEqual(declined.status, 200);
    const confirmedAfterDecline = await Booking.findOne({ 'contact.email': 'flyer-17h@example.test', status: 'CONFIRMED' });
    assert.equal(confirmedAfterDecline, null);

    const bookBody = {
      checkoutToken: checkout.payload.data.checkoutToken,
      confirmPrice: { amount: required.requiredAmount, currency: 'INR' },
      payment: { method: 'CARD', cardNumber: '4111111111114242', idempotencyKey: 'pay-17h-1' },
      idempotencyKey: 'book-17h-1',
    };
    const [bookedLeft, bookedRight] = await Promise.all([
      json(server, 'POST', '/api/v1/flights/book', { token, body: bookBody }),
      json(server, 'POST', '/api/v1/flights/book', { token, body: bookBody }),
    ]);
    assert.equal(bookedLeft.status, 200, JSON.stringify(bookedLeft.payload));
    assert.equal(bookedRight.status, 200, JSON.stringify(bookedRight.payload));
    assert.equal(bookedLeft.payload.data.aplBookingRef, bookedRight.payload.data.aplBookingRef);
    const booked = bookedLeft;
    assert.equal(booked.payload.data.testBooking, true);
    assert.match(booked.payload.data.notice, /MOCK BOOKING/);
    assert.equal(booked.payload.data.bookingStatus, 'CONFIRMED');
    assert.ok(booked.payload.data.items[0].supplierBookingRef);

    const replay = await json(server, 'POST', '/api/v1/flights/book', {
      token,
      body: {
        checkoutToken: checkout.payload.data.checkoutToken,
        confirmPrice: { amount: required.requiredAmount, currency: 'INR' },
        payment: { method: 'CARD', cardNumber: '4111111111114242', idempotencyKey: 'pay-17h-1' },
        idempotencyKey: 'book-17h-1',
      },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(replay.payload.data.aplBookingRef, booked.payload.data.aplBookingRef);
    const copies = await Booking.countDocuments({ aplBookingRef: booked.payload.data.aplBookingRef });
    assert.equal(copies, 1);

    const failedSupplierCheckout = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns: { seats: [], meals: [], baggage: [] },
        confirmPrice: { amount: 1, currency: 'INR' },
      },
    });
    const supplierRequired = failedSupplierCheckout.status === 400
      ? failedSupplierCheckout.payload.error.details.find((row) => row.requiredAmount)?.requiredAmount
      : null;
    const supplierCheckout = supplierRequired
      ? await json(server, 'POST', '/api/v1/flights/checkout', {
          token,
          body: {
            ...lookup,
            contact,
            travellers,
            addOns: { seats: [], meals: [], baggage: [] },
            confirmPrice: { amount: supplierRequired, currency: 'INR' },
          },
        })
      : failedSupplierCheckout;
    assert.equal(supplierCheckout.status, 200);
    const supplierBlock = await json(server, 'POST', '/api/v1/flights/block', {
      token,
      body: { checkoutToken: supplierCheckout.payload.data.checkoutToken },
    });
    assert.equal(supplierBlock.status, 200, JSON.stringify(supplierBlock.payload));
    const supplierFail = await json(server, 'POST', '/api/v1/flights/book', {
      token,
      body: {
        checkoutToken: supplierCheckout.payload.data.checkoutToken,
        confirmPrice: { amount: supplierCheckout.payload.data.pricing.amount, currency: 'INR' },
        payment: { method: 'CARD', cardNumber: '4111111111114242' },
        simulateBookingFailure: true,
      },
    });
    assert.notEqual(supplierFail.status, 200);
    const failedSession = await CheckoutSession.findOne({
      checkoutToken: supplierCheckout.payload.data.checkoutToken,
    }).lean();
    assert.equal(failedSession.status, 'PAYMENT_CAPTURED_BOOKING_FAILED');
    const extraConfirmed = await Booking.countDocuments({ status: 'CONFIRMED', dsaId: session.dsaId });
    assert.equal(extraConfirmed, 1);

    const stored = await Booking.findOne({ aplBookingRef: booked.payload.data.aplBookingRef }).lean();
    assert.equal(String(stored.dsaId), dsaId);
    assert.equal(stored.travellers[0].lastName, 'Tester');
    assert.equal(stored.totalAmount, required.requiredAmount);
    assert.ok(stored.items[0].supplierBookingRef);
    const payment = await Payment.findOne({ bookingId: stored._id }).lean();
    assert.equal(payment.status, 'SUCCESS');
    assert.ok(payment.paymentRef);

    const foreign = await json(server, 'POST', '/api/v1/flights/bookings/details', {
      token,
      host: OTHER,
      body: { aplBookingRef: stored.aplBookingRef },
    });
    assert.notEqual(foreign.status, 200);
    assert.match(search.payload.data.journeyId, /^APL-JRN-/);
    const journeyLogs = await ServiceLog.find({ journeyId: search.payload.data.journeyId }).lean();
    const operations = new Set(journeyLogs.map((row) => row.businessOperation).filter(Boolean));
    assert.ok(operations.has('SEARCH'));
    assert.ok(operations.has('CONFIRM_FARE'));
    assert.ok(operations.has('SSR'));
    assert.ok(journeyLogs.some((row) => row.stage === 'SUPPLIER_REQUEST' && row.supplierCode === 'TBO'));
    assert.equal(stored.journeyId, fareBlock.payload.data.journeyId);

    const seatCheckout = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns: { seats: [], meals: [], baggage: [] },
        confirmPrice: { amount: supplierCheckout.payload.data.pricing.amount, currency: 'INR' },
      },
    });
    assert.equal(seatCheckout.status, 200, JSON.stringify(seatCheckout.payload));
    await CheckoutSession.updateOne(
      { checkoutToken: seatCheckout.payload.data.checkoutToken },
      { $set: { 'offerSnapshot.addOns': [{ code: '12B', segmentKey }] } },
    );
    const seatBlock = await json(server, 'POST', '/api/v1/flights/block', {
      token,
      body: { checkoutToken: seatCheckout.payload.data.checkoutToken },
    });
    assert.equal(seatBlock.status, 400);

    const failBlockCheckout = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns: { seats: [], meals: [], baggage: [] },
        confirmPrice: { amount: supplierCheckout.payload.data.pricing.amount, currency: 'INR' },
      },
    });
    const failBlock = await json(server, 'POST', '/api/v1/flights/block', {
      token,
      body: {
        checkoutToken: failBlockCheckout.payload.data.checkoutToken,
        simulateBlockFailure: true,
      },
    });
    assert.equal(failBlock.status, 400);

    const expiryCheckout = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns: { seats: [], meals: [], baggage: [] },
        confirmPrice: { amount: supplierCheckout.payload.data.pricing.amount, currency: 'INR' },
      },
    });
    assert.equal(expiryCheckout.status, 200, JSON.stringify(expiryCheckout.payload));
    const expiryBlock = await json(server, 'POST', '/api/v1/flights/block', {
      token,
      body: { checkoutToken: expiryCheckout.payload.data.checkoutToken },
    });
    assert.equal(expiryBlock.status, 200, JSON.stringify(expiryBlock.payload));
    await CheckoutSession.updateOne(
      { checkoutToken: expiryCheckout.payload.data.checkoutToken },
      { $set: { 'block.expiresAt': new Date(Date.now() - 1000).toISOString() } },
    );
    const expiredPay = await json(server, 'POST', '/api/v1/flights/book', {
      token,
      body: {
        checkoutToken: expiryCheckout.payload.data.checkoutToken,
        confirmPrice: { amount: expiryCheckout.payload.data.pricing.amount, currency: 'INR' },
        payment: { method: 'CARD', cardNumber: '4111111111114242', idempotencyKey: 'expired-block' },
      },
    });
    assert.notEqual(expiredPay.status, 200);

    const mismatchCheckout = await json(server, 'POST', '/api/v1/flights/checkout', {
      token,
      body: {
        ...lookup,
        contact,
        travellers,
        addOns: { seats: [], meals: [], baggage: [] },
        confirmPrice: { amount: supplierCheckout.payload.data.pricing.amount, currency: 'INR' },
      },
    });
    const mismatchBlock = await json(server, 'POST', '/api/v1/flights/block', {
      token,
      body: { checkoutToken: mismatchCheckout.payload.data.checkoutToken },
    });
    assert.equal(mismatchBlock.status, 200, JSON.stringify(mismatchBlock.payload));
    await CheckoutSession.updateOne(
      { checkoutToken: mismatchCheckout.payload.data.checkoutToken },
      { $set: { 'block.amount': 1 } },
    );
    const mismatchPay = await json(server, 'POST', '/api/v1/flights/book', {
      token,
      body: {
        checkoutToken: mismatchCheckout.payload.data.checkoutToken,
        confirmPrice: { amount: mismatchCheckout.payload.data.pricing.amount, currency: 'INR' },
        payment: { method: 'CARD', cardNumber: '4111111111114242', idempotencyKey: 'amount-mismatch' },
      },
    });
    assert.notEqual(mismatchPay.status, 200);

    const disabled = await DsaService.updateOne(
      { dsaId, serviceId: (await Service.findOne({ code: 'flight' }))._id },
      { isActiveByDSA: false },
    );
    assert.equal(disabled.modifiedCount, 1);
    const blocked = await json(server, 'POST', '/api/v1/flights/search', {
      token,
      body: {
        origin: 'DEL',
        destination: 'BLR',
        departDate: '2026-11-21',
        adults: 1,
      },
    });
    assert.equal(blocked.status, 403);
  });
});
