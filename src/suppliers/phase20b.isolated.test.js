'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase20b';
process.env.PUBLIC_DEV_HOST_MAP = 'phase20b.localhost=APL-DSA-2081,other20b.localhost=APL-DSA-2082';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { seedAdminRoles } = require('../admin-auth/services/seed-roles');
const { createAplAdminUser } = require('../apl-admin/services/apl-auth.service');
const { createDsaAdminUser } = require('../dsa-admin/services/dsa-auth.service');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const DsaService = require('../tenant/models/DsaService');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const DsaSupplier = require('../common/database/models/DsaSupplier');
const ServiceLog = require('../common/database/models/ServiceLog');
const CheckoutSession = require('../common/database/models/CheckoutSession');
const { Booking } = require('../common/database/models/Booking');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase20b';
const HOST = 'phase20b.localhost';
const travellers = [{
  type: 'ADULT', title: 'Mr', firstName: 'Aman', lastName: 'Tester', gender: 'MALE', dateOfBirth: '1990-01-15', age: 35,
}];
const contact = { email: 'phase20b@example.test', phone: '9990002020' };

let server;
let token;
let dsaId;
let otherDsaId;
let apl;
let dsaAdmin;
let otherAdmin;
const admins = [];

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing to run outside apl_test_phase20b');
}

async function assign(service, codes, strategy) {
  for (const [index, code] of codes.entries()) {
    const supplier = await Supplier.findOneAndUpdate(
      { code },
      { $set: { name: `${code} Mock`, status: 'ACTIVE', isMock: true, environments: ['TEST'], defaultEnvironment: 'TEST' } },
      { upsert: true, new: true },
    );
    await SupplierService.findOneAndUpdate(
      { supplierId: supplier._id, serviceId: service._id },
      { $set: { enabled: true, environment: 'TEST' } },
      { upsert: true },
    );
    await DsaSupplier.create({
      dsaId, serviceId: service._id, supplierId: supplier._id, enabled: true, priority: index + 1, routingStrategy: strategy,
    });
  }
}

function postRaw(path, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-apl-public-host': HOST,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function json(method, path, { body, auth, host = HOST } = {}) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-apl-public-host': host,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, payload: await res.json() }));
}

function captchaAnswer(image) {
  const svg = Buffer.from(String(image).split(',')[1], 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<])<\/text>/g)].map((match) => match[1]).join('');
}

async function checkoutAt(path, body) {
  const probe = await json('POST', path, {
    token: undefined,
    auth: token,
    body: { ...body, confirmPrice: { amount: 1, currency: 'INR' } },
  });
  assert.equal(probe.status, 400, JSON.stringify(probe.payload));
  const required = (probe.payload.error?.details || []).find((row) => row.requiredAmount);
  assert.ok(required, JSON.stringify(probe.payload));
  const bookedPrice = { amount: required.requiredAmount, currency: required.currency || 'INR' };
  const created = await json('POST', path, { auth: token, body: { ...body, confirmPrice: bookedPrice } });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return { created, price: bookedPrice };
}

async function bookOnce(path, checkoutToken, price, key) {
  return json('POST', path, {
    auth: token,
    body: {
      checkoutToken,
      confirmPrice: price,
      idempotencyKey: key,
      payment: { method: 'CARD', cardNumber: '4111111111114242', idempotencyKey: key },
    },
  });
}

function startAdmin(cwd, port) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      PORT: String(port),
      MONGODB_URI: URI,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  admins.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`admin ${port} did not listen`)), 25000);
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`admin ${port} exited ${code}`));
    });
  });
}

describe('phase 20b isolated verification', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    await seedAdminRoles();
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2081', companyName: 'Phase 20B', displayName: 'Phase 20B',
      ownerName: 'Owner', email: 'owner20b@example.test', phone: '9990002021', subdomain: 'phase20b', status: 'ACTIVE',
    });
    const other = await Dsa.create({
      dsaCode: 'APL-DSA-2082', companyName: 'Other 20B', displayName: 'Other 20B',
      ownerName: 'Other', email: 'other20b@example.test', phone: '9990002022', subdomain: 'other20b', status: 'ACTIVE',
    });
    dsaId = dsa._id;
    otherDsaId = other._id;
    for (const code of ['flight', 'hotel', 'bus', 'transfer']) {
      const service = await Service.findOne({ code });
      await DsaService.create({ dsaId, serviceId: service._id, isAllowedByAPL: true, isActiveByDSA: true });
    }
    await assign(await Service.findOne({ code: 'flight' }), ['TBO', 'TRIPJACK', 'KAFILA'], 'PARALLEL');
    await assign(await Service.findOne({ code: 'hotel' }), ['TBO', 'TRIPJACK', 'KAFILA'], 'PARALLEL');
    await assign(await Service.findOne({ code: 'bus' }), ['MOCKBUS_A', 'MOCKBUS_B'], 'PARALLEL');
    await assign(await Service.findOne({ code: 'transfer' }), ['MOCKXFER_A', 'MOCKXFER_B'], 'FALLBACK');
    await createAplAdminUser({ name: 'Phase Admin', email: 'phase20b-admin@example.test', password: 'Phase20b-Admin!' });
    await createDsaAdminUser({ dsaId, name: 'Phase DSA', email: 'phase20b-dsa@example.test', password: 'Phase20b-Dsa!' });
    await createDsaAdminUser({ dsaId: otherDsaId, name: 'Other DSA', email: 'other20b-dsa@example.test', password: 'Phase20b-Dsa!' });
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const captcha = await json('GET', '/api/v1/auth/captcha');
    const created = await json('POST', '/api/v1/auth/signup', {
      body: {
        name: 'Phase Tester', email: 'phase20b-user@example.test', phoneNumber: '9990002020',
        password: 'Test-pass-20b', currency: 'INR',
        captchaId: captcha.payload.data.captchaId,
        captchaAnswer: captchaAnswer(captcha.payload.data.image),
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    token = created.payload.data.loginToken;
  });

  after(async () => {
    for (const child of admins) child.kill('SIGTERM');
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('blocks one checkout once and does not collapse a second checkout', async () => {
    const search = await json('POST', '/api/v1/flights/search', {
      auth: token,
      body: {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BLR', departureDate: '2026-12-20',
        passengers: { adults: 1, children: 0, infants: 0 }, cabinClass: 'ECONOMY',
      },
    });
    assert.equal(search.status, 200, JSON.stringify(search.payload));
    const flight = search.payload.data.flights[0];
    const fareId = flight.flightFareData[0].aplFareId;
    const quote = await json('POST', '/api/v1/flights/fare-quote', {
      auth: token,
      body: { searchId: search.payload.data.searchId, aplFlightId: flight.aplFlightId, aplFareId: fareId },
    });
    assert.equal(quote.status, 200, JSON.stringify(quote.payload));
    const mismatch = await json('POST', '/api/v1/flights/fare-quote', {
      auth: token,
      body: { searchId: search.payload.data.searchId, aplFlightId: flight.aplFlightId, aplFareId: fareId, supplier: 'NOT_A_SUPPLIER' },
    });
    assert.equal(mismatch.status, 400);
    const lookup = { searchId: search.payload.data.searchId, aplFlightId: flight.aplFlightId, aplFareId: fareId };
    const first = await checkoutAt('/api/v1/flights/checkout', { ...lookup, contact, travellers, addOns: { seats: [], meals: [], baggage: [] } });
    const second = await checkoutAt('/api/v1/flights/checkout', { ...lookup, contact, travellers, addOns: { seats: [], meals: [], baggage: [] } });
    const tokenA = first.created.payload.data.checkoutToken;
    const tokenB = second.created.payload.data.checkoutToken;
    const [left, right] = await Promise.all([
      postRaw('/api/v1/flights/block', { checkoutToken: tokenA }),
      postRaw('/api/v1/flights/block', { checkoutToken: tokenA }),
    ]);
    assert.equal(left.status, 200, JSON.stringify(left.payload));
    assert.equal(right.status, 200, JSON.stringify(right.payload));
    assert.equal(left.payload.data.blockRef, right.payload.data.blockRef);
    assert.equal(left.payload.data.journeyId, right.payload.data.journeyId);
    assert.equal(left.payload.data.supplier, quote.payload.data.supplier);
    const sharedBlocks = await ServiceLog.countDocuments({
      businessOperation: 'BLOCK', stage: 'SUPPLIER_REQUEST', searchId: search.payload.data.searchId,
    });
    assert.equal(sharedBlocks, 1);
    const other = await json('POST', '/api/v1/flights/block', { auth: token, body: { checkoutToken: tokenB } });
    assert.equal(other.status, 200, JSON.stringify(other.payload));
    assert.notEqual(other.payload.data.blockRef, left.payload.data.blockRef);
    const separateBlocks = await ServiceLog.countDocuments({
      businessOperation: 'BLOCK', stage: 'SUPPLIER_REQUEST', searchId: search.payload.data.searchId,
    });
    assert.equal(separateBlocks, 2);
    const sessions = await CheckoutSession.countDocuments({ checkoutToken: { $in: [tokenA, tokenB] }, 'block.status': 'ACCEPTED' });
    assert.equal(sessions, 2);
  });

  it('books a hotel on the selected supplier without a duplicate', async () => {
    const search = await json('POST', '/api/v1/hotels/search', {
      auth: token,
      body: { city: 'New Delhi', checkIn: '2026-12-01', checkOut: '2026-12-03', rooms: 1, adults: 2, children: 0, currency: 'INR' },
    });
    assert.equal(search.status, 200, JSON.stringify(search.payload));
    const hotel = search.payload.data.hotels[0];
    const room = hotel.availableRooms[0];
    const details = await json('POST', '/api/v1/hotels/details', {
      auth: token, body: { searchId: search.payload.data.searchId, aplHotelId: hotel.aplHotelId, aplRoomId: room.aplRoomId },
    });
    assert.equal(details.status, 200, JSON.stringify(details.payload));
    const recheck = await json('POST', '/api/v1/hotels/revalidate', {
      auth: token, body: { searchId: search.payload.data.searchId, aplHotelId: hotel.aplHotelId, aplRoomId: room.aplRoomId },
    });
    assert.equal(recheck.status, 200);
    assert.equal(recheck.payload.data.supplier, room.supplier);
    const wrong = await json('POST', '/api/v1/hotels/revalidate', {
      auth: token, body: { searchId: search.payload.data.searchId, aplHotelId: hotel.aplHotelId, aplRoomId: room.aplRoomId, supplier: 'NOT_A_SUPPLIER' },
    });
    assert.equal(wrong.status, 400);
    const { created, price } = await checkoutAt('/api/v1/hotels/checkout', {
      searchId: search.payload.data.searchId, aplHotelId: hotel.aplHotelId, aplRoomId: room.aplRoomId,
      contact, guests: travellers, guestCount: 1,
    });
    const session = await CheckoutSession.findOne({ checkoutToken: created.payload.data.checkoutToken });
    assert.equal(String(session.dsaId), String(dsaId));
    assert.equal(session.offerSnapshot.supplier, room.supplier);
    assert.equal(session.pricing.amount, price.amount);
    assert.equal(session.commercialSnapshot.pricingVersion, '12.0');
    const booked = await bookOnce('/api/v1/hotels/book', created.payload.data.checkoutToken, price, 'hotel-20b');
    const replay = await bookOnce('/api/v1/hotels/book', created.payload.data.checkoutToken, price, 'hotel-20b');
    assert.equal(booked.status, 200, JSON.stringify(booked.payload));
    assert.equal(replay.status, 200);
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(await Booking.countDocuments({ aplBookingRef: booked.payload.data.aplBookingRef }), 1);
    const ops = await ServiceLog.distinct('businessOperation', { searchId: search.payload.data.searchId });
    for (const name of ['SEARCH', 'DETAILS', 'RECHECK', 'CHECKOUT', 'PAYMENT', 'BOOK']) {
      assert.ok(ops.includes(name), `hotel ${name} missing from ${ops.join(',')}`);
    }
  });

  it('books a bus on the selected supplier without a duplicate', async () => {
    const search = await json('POST', '/api/v1/buses/search', {
      auth: token, body: { origin: 'New York', destination: 'Boston', travelDate: '2026-12-01' },
    });
    assert.equal(search.status, 200, JSON.stringify(search.payload));
    const bus = search.payload.data.buses[0];
    const offer = bus.offers[0];
    const details = await json('POST', '/api/v1/buses/details', {
      auth: token, body: { searchId: search.payload.data.searchId, aplBusId: bus.aplBusId, aplOfferId: offer.aplOfferId },
    });
    assert.equal(details.status, 200, JSON.stringify(details.payload));
    const seat = details.payload.data.seatInventory.availableSeats[0];
    const recheck = await json('POST', '/api/v1/buses/revalidate', {
      auth: token, body: { searchId: search.payload.data.searchId, aplBusId: bus.aplBusId, aplOfferId: offer.aplOfferId },
    });
    assert.equal(recheck.status, 200);
    const { created, price } = await checkoutAt('/api/v1/buses/checkout', {
      searchId: search.payload.data.searchId, aplBusId: bus.aplBusId, aplOfferId: offer.aplOfferId,
      contact, travellers, selectedSeats: [seat],
      boardingPointCode: details.payload.data.boardingPoints[0].code,
      droppingPointCode: details.payload.data.droppingPoints[0].code,
    });
    const session = await CheckoutSession.findOne({ checkoutToken: created.payload.data.checkoutToken });
    assert.equal(String(session.dsaId), String(dsaId));
    assert.equal(session.offerSnapshot.supplier, offer.supplier);
    assert.equal(session.commercialSnapshot.pricingVersion, '12.0');
    const booked = await bookOnce('/api/v1/buses/book', created.payload.data.checkoutToken, price, 'bus-20b');
    const replay = await bookOnce('/api/v1/buses/book', created.payload.data.checkoutToken, price, 'bus-20b');
    assert.equal(booked.status, 200, JSON.stringify(booked.payload));
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(await Booking.countDocuments({ aplBookingRef: booked.payload.data.aplBookingRef }), 1);
    const busOps = await ServiceLog.distinct('businessOperation', { searchId: search.payload.data.searchId });
    for (const name of ['SEARCH', 'DETAILS', 'RECHECK', 'CHECKOUT', 'PAYMENT', 'BOOK']) {
      assert.ok(busOps.includes(name), `bus ${name} missing from ${busOps.join(',')}`);
    }
  });

  it('books a transfer on the primary supplier without calling the fallback', async () => {
    const search = await json('POST', '/api/v1/transfers/search', {
      auth: token,
      body: {
        pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
        dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
        pickupDateTime: '2026-12-01T14:30', passengers: 2,
      },
    });
    assert.equal(search.status, 200, JSON.stringify(search.payload));
    const transfer = search.payload.data.transfers[0];
    const offer = transfer.offers[0];
    const suppliers = await ServiceLog.distinct('supplierCode', { searchId: search.payload.data.searchId, stage: 'SUPPLIER_REQUEST' });
    assert.deepEqual(suppliers, ['MOCKXFER_A']);
    const details = await json('POST', '/api/v1/transfers/details', {
      auth: token, body: { searchId: search.payload.data.searchId, aplTransferId: transfer.aplTransferId, aplOfferId: offer.aplOfferId },
    });
    assert.equal(details.status, 200, JSON.stringify(details.payload));
    const recheck = await json('POST', '/api/v1/transfers/revalidate', {
      auth: token, body: { searchId: search.payload.data.searchId, aplTransferId: transfer.aplTransferId, aplOfferId: offer.aplOfferId },
    });
    assert.equal(recheck.status, 200);
    const { created, price } = await checkoutAt('/api/v1/transfers/checkout', {
      searchId: search.payload.data.searchId, aplTransferId: transfer.aplTransferId, aplOfferId: offer.aplOfferId, contact, travellers,
    });
    const session = await CheckoutSession.findOne({ checkoutToken: created.payload.data.checkoutToken });
    assert.equal(String(session.dsaId), String(dsaId));
    assert.equal(session.offerSnapshot.supplier, offer.supplier);
    const booked = await bookOnce('/api/v1/transfers/book', created.payload.data.checkoutToken, price, 'transfer-20b');
    const replay = await bookOnce('/api/v1/transfers/book', created.payload.data.checkoutToken, price, 'transfer-20b');
    assert.equal(booked.status, 200, JSON.stringify(booked.payload));
    assert.equal(replay.payload.data.idempotentReplay, true);
    assert.equal(await Booking.countDocuments({ aplBookingRef: booked.payload.data.aplBookingRef }), 1);
    const ops = await ServiceLog.distinct('businessOperation', { searchId: search.payload.data.searchId });
    for (const name of ['SEARCH', 'DETAILS', 'RECHECK', 'CHECKOUT', 'PAYMENT', 'BOOK']) {
      assert.ok(ops.includes(name), `transfer ${name} missing from ${ops.join(',')}`);
    }
  });

  it('shows the same isolated journey to APLAdmin and only the owning DSA', async () => {
    apl = await startAdmin('/Users/rohandalal/Developer/AplTech/APLADMIN/APLAdminBackEnd', 3015);
    dsaAdmin = await startAdmin('/Users/rohandalal/Developer/AplTech/DSAADMIN/DSAAdminBackEnd', 3014);
    const aplLogin = await fetch('http://127.0.0.1:3015/api/apl-admin/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'phase20b-admin@example.test', password: 'Phase20b-Admin!' }),
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(aplLogin.status, 200, JSON.stringify(aplLogin.payload));
    const aplToken = aplLogin.payload.data.token;
    const list = await fetch('http://127.0.0.1:3015/api/apl-admin/journeys?service=HOTEL', {
      headers: { authorization: `Bearer ${aplToken}` },
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(list.status, 200, JSON.stringify(list.payload));
    const row = list.payload.data.items[0];
    assert.ok(row?.journeyId);
    const detail = await fetch(`http://127.0.0.1:3015/api/apl-admin/journeys/${row.journeyId}`, {
      headers: { authorization: `Bearer ${aplToken}` },
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(detail.status, 200, JSON.stringify(detail.payload));
    const events = detail.payload.data.operations.flatMap((operation) => operation.events || []);
    assert.ok(events.some((event) => event.role === 'Main Request'));
    assert.ok(events.some((event) => event.role === 'Main Response'));
    assert.ok(events.some((event) => event.role === 'Supplier Request'));
    assert.ok(events.some((event) => event.role === 'Supplier Response'));
    const download = await fetch(`http://127.0.0.1:3015/api/apl-admin/journeys/${row.journeyId}/events/${events[0].id}`, {
      headers: { authorization: `Bearer ${aplToken}` },
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(download.status, 200, JSON.stringify(download.payload));
    assert.ok(download.payload.data.content);

    const ownLogin = await fetch('http://127.0.0.1:3014/api/dsa-admin/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'phase20b-dsa@example.test', password: 'Phase20b-Dsa!' }),
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(ownLogin.status, 200, JSON.stringify(ownLogin.payload));
    const own = await fetch(`http://127.0.0.1:3014/api/dsa-admin/journeys?service=HOTEL`, {
      headers: { authorization: `Bearer ${ownLogin.payload.data.token}` },
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(own.status, 200);
    assert.ok(own.payload.data.items.some((item) => item.journeyId === row.journeyId));
    const ownDetail = await fetch(`http://127.0.0.1:3014/api/dsa-admin/journeys/${row.journeyId}`, {
      headers: { authorization: `Bearer ${ownLogin.payload.data.token}` },
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(ownDetail.status, 200);

    const foreignLogin = await fetch('http://127.0.0.1:3014/api/dsa-admin/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other20b-dsa@example.test', password: 'Phase20b-Dsa!' }),
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    const foreign = await fetch(`http://127.0.0.1:3014/api/dsa-admin/journeys/${row.journeyId}`, {
      headers: { authorization: `Bearer ${foreignLogin.payload.data.token}` },
    }).then(async (res) => ({ status: res.status, payload: await res.json() }));
    assert.equal(foreign.status, 404);
    otherAdmin = foreign;
  });
});
