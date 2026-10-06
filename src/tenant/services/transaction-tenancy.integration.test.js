'use strict';

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../../common/database/connection');
const { createApp } = require('../../app');
const { seedAdminRoles } = require('../../admin-auth/services/seed-roles');
const { seedMasterServices } = require('../services/seed-master-services');
const { createDsa, setDsaStatus } = require('../services/dsa.service');
const {
  upsertDsaServiceMapping,
} = require('../services/dsa-service-mapping.service');
const Service = require('../models/Service');
const Dsa = require('../models/Dsa');
const ServiceLog = require('../../common/database/models/ServiceLog');
const SupplierRawPayload = require('../../common/database/models/SupplierRawPayload');
const Search = require('../../common/database/models/Search');
const { Booking } = require('../../common/database/models/Booking');
const User = require('../../user/models/User');
const { config } = require('../../common/config');
const crypto = require('crypto');
const LoginSession = require('../../user/models/LoginSession');

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

describeDb('Phase 9 transaction tenant foundation', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let flight;
  let hotel;
  let hostA;
  let hostB;
  const dsaIds = [];
  const previousDevMap = config.publicDevHostMap;

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp();
    ({ server, port } = await listen(app));

    const stamp = Date.now();
    hostA = `tx-a-${stamp}.example.test`;
    hostB = `tx-b-${stamp}.example.test`;

    dsaA = await createDsa({
      companyName: 'Phase9 DSA A',
      displayName: 'Tx A',
      ownerName: 'Owner A',
      email: `p9.a.${stamp}@example.com`,
      phone: '+919900000001',
      domain: hostA,
      subdomain: `txa${stamp}`,
      status: 'ACTIVE',
    });
    dsaB = await createDsa({
      companyName: 'Phase9 DSA B',
      displayName: 'Tx B',
      ownerName: 'Owner B',
      email: `p9.b.${stamp}@example.com`,
      phone: '+919900000002',
      domain: hostB,
      subdomain: `txb${stamp}`,
      status: 'ACTIVE',
    });
    dsaIds.push(String(dsaA._id || dsaA.id), String(dsaB._id || dsaB.id));

    flight = await Service.findOne({ code: 'flight' }).lean();
    hotel = await Service.findOne({ code: 'hotel' }).lean();
    assert.ok(flight && hotel);

    for (const dsa of [dsaA, dsaB]) {
      const dsaId = dsa._id || dsa.id;
      await upsertDsaServiceMapping({
        dsaId,
        serviceId: flight._id,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
      await upsertDsaServiceMapping({
        dsaId,
        serviceId: hotel._id,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }

    // Dev host map entry for localhost-style forwarding tests
    if (!config.isProduction) {
      config.publicDevHostMap.set('localhost:3001', dsaA.dsaCode || dsaA.code);
    }
  });

  after(async () => {
    config.publicDevHostMap = previousDevMap;
    await Booking.deleteMany({
      $or: [{ dsaId: { $in: dsaIds } }, { guestEmail: /p9@example\.com/i }, { aplBookingRef: /^APL-BK-LEG/ }],
    });
    await Search.deleteMany({ dsaId: { $in: dsaIds } });
    await ServiceLog.deleteMany({ dsaId: { $in: dsaIds } });
    await SupplierRawPayload.deleteMany({ dsaId: { $in: dsaIds } });
    await User.deleteMany({ email: /^p9\./i });
    await Dsa.deleteMany({ _id: { $in: dsaIds } });
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
  });

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
      email: `p9.${label}.${Date.now()}@example.com`.toLowerCase(),
      phoneNumber: '9876543210',
      passwordHash: `${salt}:${hash}`,
      currency: 'INR',
      balance: 0,
    });
    const loginToken = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(loginToken).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    return { user, loginToken };
  }

  it('1) host resolves correct transaction DSA for flight search', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(hostA, { 'x-request-id': 'p9-req-host-1' }),
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-11-10',
        adults: 1,
        children: 0,
        infants: 0,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(res.json?.data?.searchId);
    assert.equal(res.json?.meta?.requestId, 'p9-req-host-1');

    const search = await Search.findOne({ aplSearchId: res.json.data.searchId }).lean();
    assert.equal(String(search.dsaId), dsaIds[0]);
    assert.equal(search.requestId, 'p9-req-host-1');
  });

  it('2) client-supplied dsaId cannot override trusted host tenant', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(hostA, {
        'x-request-id': 'p9-req-override',
        'x-dsa-id': dsaIds[1],
      }),
      body: {
        dsaId: dsaIds[1],
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-11-11',
        adults: 1,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const search = await Search.findOne({ aplSearchId: res.json.data.searchId }).lean();
    assert.equal(String(search.dsaId), dsaIds[0]);
    assert.notEqual(String(search.dsaId), dsaIds[1]);
  });

  it('3) inactive DSA transaction rejected', async () => {
    await setDsaStatus(dsaIds[0], 'SUSPENDED');
    try {
      const res = await httpJson(port, 'POST', '/api/v1/flights/search', {
        headers: tenantHeaders(hostA),
        body: {
          originCityCode: 'DEL',
          destinationCityCode: 'BOM',
          departDate: '2026-11-12',
          adults: 1,
        },
      });
      assert.equal(res.status, 403);
      assert.equal(res.json?.success, false);
    } finally {
      await setDsaStatus(dsaIds[0], 'ACTIVE');
    }
  });

  it('4) service not offered → direct search rejected', async () => {
    await upsertDsaServiceMapping({
      dsaId: dsaIds[0],
      serviceId: hotel._id,
      isAllowedByAPL: false,
      isActiveByDSA: true,
    });
    try {
      const res = await httpJson(port, 'POST', '/api/v1/hotels/search', {
        headers: tenantHeaders(hostA),
        body: {
          cityCode: '130443',
          city: 'New Delhi',
          country: 'IN',
          checkIn: '2026-12-01',
          checkOut: '2026-12-03',
          rooms: 1,
          adults: 2,
          children: 0,
        },
      });
      assert.equal(res.status, 403);
      assert.match(String(res.json?.error?.ErrorMessage || ''), /not available/i);
    } finally {
      await upsertDsaServiceMapping({
        dsaId: dsaIds[0],
        serviceId: hotel._id,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }
  });

  it('5-6) flight search inbound + supplier logs and raw payloads carry dsaId/requestId', async () => {
    const requestId = `p9-logs-${Date.now()}`;
    const res = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(hostA, { 'x-request-id': requestId }),
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-11-13',
        adults: 1,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const searchId = res.json.data.searchId;

    // Allow inbound finish handler to flush
    await new Promise((r) => setTimeout(r, 150));

    const supplierLogs = await ServiceLog.find({
      requestId,
      direction: 'SUPPLIER',
      service: 'FLIGHT',
    }).lean();
    assert.ok(supplierLogs.length >= 1);
    for (const log of supplierLogs) {
      assert.equal(String(log.dsaId), dsaIds[0]);
      assert.equal(log.searchId, searchId);
    }

    const raws = await SupplierRawPayload.find({ searchId }).lean();
    assert.ok(raws.length >= 1);
    for (const raw of raws) {
      assert.equal(String(raw.dsaId), dsaIds[0]);
      assert.equal(raw.requestId, requestId);
    }

    const inbound = await ServiceLog.findOne({
      requestId,
      direction: 'INBOUND',
      service: 'FLIGHT',
    }).lean();
    assert.ok(inbound);
    assert.equal(String(inbound.dsaId), dsaIds[0]);
  });

  it('7-9) checkout→book stores trusted dsaId; client cannot override; later stage preserves it', async () => {
    const searchRes = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(hostA, { 'x-request-id': 'p9-book-search' }),
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-11-14',
        adults: 1,
      },
    });
    assert.equal(searchRes.status, 200, JSON.stringify(searchRes.json));
    const flightRow = searchRes.json.data.flights[0];
    assert.ok(flightRow);
    const fare = flightRow.flightFareData[0];
    assert.ok(fare);

    const { loginToken: token } = await createTestUser('booker');
    assert.ok(token);

    const amount = fare.price.amount;
    const checkout = await httpJson(port, 'POST', '/api/v1/flights/checkout', {
      headers: tenantHeaders(hostA, {
        'x-request-id': 'p9-book-checkout',
      }),
      body: {
        searchId: searchRes.json.data.searchId,
        aplFlightId: flightRow.aplFlightId,
        aplFareId: fare.aplFareId,
        dsaId: dsaIds[1],
        contact: { email: 'p9@example.com', phone: '9999999999' },
        travellers: [
          {
            type: 'ADULT',
            title: 'Mr',
            firstName: 'Phase',
            lastName: 'Nine',
          },
        ],
        confirmPrice: { amount, currency: fare.price.currency },
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.json));
    const checkoutToken = checkout.json.data.checkoutToken;

    const book = await httpJson(port, 'POST', '/api/v1/flights/book', {
      headers: tenantHeaders(hostA, {
        Authorization: `Bearer ${token}`,
        'x-request-id': 'p9-book-confirm',
      }),
      body: {
        checkoutToken,
        dsaId: dsaIds[1],
        payment: { method: 'UPI', upiId: 'phase9@upi' },
        confirmPrice: { amount, currency: fare.price.currency },
      },
    });
    assert.equal(book.status, 200, JSON.stringify(book.json));
    const ref = book.json.data.aplBookingRef;

    const booking = await Booking.findOne({ aplBookingRef: ref }).lean();
    assert.ok(booking);
    assert.equal(String(booking.dsaId), dsaIds[0]);
    assert.notEqual(String(booking.dsaId), dsaIds[1]);
    assert.equal(booking.requestId, 'p9-book-confirm');

    // 10) DSA B host cannot operate on DSA A booking
    const detailsB = await httpJson(port, 'POST', '/api/v1/flights/bookings/details', {
      headers: tenantHeaders(hostB, { Authorization: `Bearer ${token}` }),
      body: { aplBookingRef: ref },
    });
    assert.equal(detailsB.status, 403);

    const detailsA = await httpJson(port, 'POST', '/api/v1/flights/bookings/details', {
      headers: tenantHeaders(hostA, { Authorization: `Bearer ${token}` }),
      body: { aplBookingRef: ref },
    });
    assert.equal(detailsA.status, 200, JSON.stringify(detailsA.json));
  });

  it('11) legacy booking without dsaId remains readable under tenant host', async () => {
    const { user, loginToken: token } = await createTestUser('legacy');
    const userId = user._id;

    const legacy = await Booking.create({
      aplBookingRef: `APL-BK-LEG${Date.now().toString(36).toUpperCase()}`,
      productType: 'FLIGHT',
      status: 'CONFIRMED',
      currency: 'INR',
      totalAmount: 1000,
      userId,
      // no dsaId
      items: [],
      travellers: [],
    });

    const res = await httpJson(
      port,
      'GET',
      `/api/v1/bookings/${legacy.aplBookingRef}`,
      {
        headers: tenantHeaders(hostA, { Authorization: `Bearer ${token}` }),
      },
    );
    assert.equal(res.status, 200, JSON.stringify(res.json));
    await Booking.deleteOne({ _id: legacy._id });
  });

  it('12) requestId propagates across supplier execution', async () => {
    const requestId = `p9-corr-${Date.now()}`;
    const res = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(hostA, { 'x-request-id': requestId }),
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-11-15',
        adults: 1,
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.meta.requestId, requestId);
    const logs = await ServiceLog.find({ requestId, direction: 'SUPPLIER' }).lean();
    assert.ok(logs.every((l) => l.requestId === requestId));
  });

  it('13) hotel uses the same generic tenant foundation', async () => {
    const requestId = `p9-hotel-${Date.now()}`;
    const res = await httpJson(port, 'POST', '/api/v1/hotels/search', {
      headers: tenantHeaders(hostA, { 'x-request-id': requestId }),
      body: {
        cityCode: '130443',
        city: 'New Delhi',
        country: 'IN',
        checkIn: '2026-12-10',
        checkOut: '2026-12-12',
        rooms: 1,
        adults: 2,
        children: 0,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const search = await Search.findOne({ aplSearchId: res.json.data.searchId }).lean();
    assert.equal(String(search.dsaId), dsaIds[0]);
    assert.equal(search.type, 'HOTEL');

    await new Promise((r) => setTimeout(r, 100));
    const logs = await ServiceLog.find({
      requestId,
      direction: 'SUPPLIER',
      service: 'HOTEL',
    }).lean();
    assert.ok(logs.length >= 1);
    assert.ok(logs.every((l) => String(l.dsaId) === dsaIds[0]));
  });

  it('14) missing host context fails safely', async () => {
    const res = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: { Host: '127.0.0.1' },
      body: {
        originCityCode: 'DEL',
        destinationCityCode: 'BOM',
        departDate: '2026-11-16',
        adults: 1,
      },
    });
    assert.ok([403, 404].includes(res.status));
    assert.equal(res.json?.success, false);
  });
});
