'use strict';

/**
 * Phase 15C — Multi-DSA onboarding, isolation, revoke, suspension.
 * Exercises APLAdmin / DSAAdmin / B2C APIs on ONE MongoDB.
 */

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('crypto');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../../common/database/connection');
const { createApp } = require('../../app');
const { seedAdminRoles } = require('../../admin-auth/services/seed-roles');
const { seedMasterServices } = require('./seed-master-services');
const { createAplAdminUser } = require('../../apl-admin/services/apl-auth.service');
const AplAdminUser = require('../../apl-admin/models/AplAdminUser');
const AplAdminSession = require('../../apl-admin/models/AplAdminSession');
const DsaAdminUser = require('../../dsa-admin/models/DsaAdminUser');
const DsaAdminSession = require('../../dsa-admin/models/DsaAdminSession');
const Dsa = require('../models/Dsa');
const DsaService = require('../models/DsaService');
const Service = require('../models/Service');
const WebsiteSettings = require('../../cms/models/WebsiteSettings');
const Search = require('../../common/database/models/Search');
const { Booking } = require('../../common/database/models/Booking');
const User = require('../../user/models/User');
const LoginSession = require('../../user/models/LoginSession');
const { hashPassword } = require('../../common/security/password');

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

describeDb('Phase 15C multi-DSA onboarding & isolation', () => {
  let server;
  let port;
  let aplToken;
  let demo;
  let sample;
  let demoAdminToken;
  let sampleAdminToken;
  let demoPassword;
  let samplePassword;
  let userToken;
  let bookingRef;
  const stamp = Date.now();
  const emails = [];
  const dsaIds = [];
  const travelDate = '2099-08-15';

  function tenantHeaders(host, extra = {}) {
    return {
      'X-APL-Public-Host': host,
      'X-Forwarded-Host': host,
      ...extra,
    };
  }

  async function createCustomer(label) {
    const email = `p15c.cust.${label}.${stamp}@example.test`;
    emails.push(email);
    const user = await User.create({
      name: `P15C ${label}`,
      email,
      phoneNumber: '9000000000',
      passwordHash: hashPassword('CustomerPass123!'),
      currency: 'INR',
      balance: 50000,
    });
    const token = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    return token;
  }

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    const aplEmail = `p15c.apl.${stamp}@example.test`;
    emails.push(aplEmail);
    await createAplAdminUser({
      name: 'P15C APL',
      email: aplEmail,
      password: 'P15cAplPass123!',
      roleCode: 'SUPER_ADMIN',
    });
    const login = await httpJson(port, 'POST', '/api/apl-admin/auth/login', {
      body: { email: aplEmail, password: 'P15cAplPass123!' },
    });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    aplToken = login.json.data.token;

    userToken = await createCustomer('a');
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (dsaIds.length) {
      await DsaService.deleteMany({ dsaId: { $in: dsaIds } });
      await WebsiteSettings.deleteMany({ dsaId: { $in: dsaIds } });
      await Search.deleteMany({ dsaId: { $in: dsaIds } });
      await Booking.deleteMany({ dsaId: { $in: dsaIds } });
      await DsaAdminSession.deleteMany({ dsaId: { $in: dsaIds } });
      await DsaAdminUser.deleteMany({ dsaId: { $in: dsaIds } });
      await Dsa.deleteMany({ _id: { $in: dsaIds } });
    }
    if (emails.length) {
      await AplAdminUser.deleteMany({ email: { $in: emails } });
      await User.deleteMany({ email: { $in: emails } });
      await DsaAdminUser.deleteMany({ email: { $in: emails } });
    }
    await AplAdminSession.deleteMany({});
    await disconnectDatabase();
  });

  it('15C.2–15C.3 onboards two DSAs via APLAdmin + provisions admins', async () => {
    const createDemo = await httpJson(port, 'POST', '/api/apl-admin/dsas', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: {
        companyName: 'E2E Demo Travel',
        displayName: 'E2E Demo Travel',
        ownerName: 'Demo Owner',
        email: `e2e.demo.company.${stamp}@example.test`,
        phone: '9111111111',
        domain: `e2e-demo-${stamp}.localhost`,
        subdomain: `e2edemo${stamp}`,
        status: 'ACTIVE',
      },
    });
    assert.equal(createDemo.status, 200, JSON.stringify(createDemo.json));
    demo = createDemo.json.data.dsa;
    dsaIds.push(demo.id);
    assert.match(demo.dsaCode, /^APL-DSA-\d+/);

    const createSample = await httpJson(port, 'POST', '/api/apl-admin/dsas', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: {
        companyName: 'E2E Sample Holidays',
        displayName: 'E2E Sample Holidays',
        ownerName: 'Sample Owner',
        email: `e2e.sample.company.${stamp}@example.test`,
        phone: '9222222222',
        domain: `e2e-sample-${stamp}.localhost`,
        subdomain: `e2esample${stamp}`,
        status: 'ACTIVE',
      },
    });
    assert.equal(createSample.status, 200, JSON.stringify(createSample.json));
    sample = createSample.json.data.dsa;
    dsaIds.push(sample.id);

    const services = await httpJson(port, 'GET', '/api/apl-admin/services', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    assert.equal(services.status, 200);
    const byCode = Object.fromEntries(
      (services.json.data.services || []).map((s) => [s.code, s]),
    );
    assert.ok(byCode.flight && byCode.hotel && byCode.bus && byCode.transfer);

    async function setAllow(dsaId, code, allowed) {
      const res = await httpJson(
        port,
        'PATCH',
        `/api/apl-admin/dsas/${dsaId}/services/${byCode[code].id}`,
        {
          headers: { Authorization: `Bearer ${aplToken}` },
          body: { isAllowedByAPL: allowed },
        },
      );
      assert.equal(res.status, 200, JSON.stringify(res.json));
    }

    // Demo: Flight+Bus yes; Hotel+Transfer no
    await setAllow(demo.id, 'flight', true);
    await setAllow(demo.id, 'bus', true);
    await setAllow(demo.id, 'hotel', false);
    await setAllow(demo.id, 'transfer', false);

    // Sample: Hotel+Transfer yes; Flight+Bus no
    await setAllow(sample.id, 'hotel', true);
    await setAllow(sample.id, 'transfer', true);
    await setAllow(sample.id, 'flight', false);
    await setAllow(sample.id, 'bus', false);

    const ceil = await httpJson(port, 'POST', '/api/apl-admin/pricing/rules', {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: {
        name: `E2E Flight ceiling ${stamp}`,
        ownerScope: 'PLATFORM',
        ruleKind: 'DSA_MARKUP_CEILING',
        serviceCode: 'flight',
        adjustmentType: 'PERCENTAGE',
        value: 10,
        status: 'ACTIVE',
        priority: 10,
      },
    });
    assert.equal(ceil.status, 200, JSON.stringify(ceil.json));

    const demoEmail = `e2e.demo.admin.${stamp}@example.test`;
    const sampleEmail = `e2e.sample.admin.${stamp}@example.test`;
    emails.push(demoEmail, sampleEmail);

    const provDemo = await httpJson(
      port,
      'POST',
      `/api/apl-admin/dsas/${demo.id}/admins`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: {
          name: 'Demo Admin',
          email: demoEmail,
          roleCode: 'DSA_OWNER',
        },
      },
    );
    assert.equal(provDemo.status, 200, JSON.stringify(provDemo.json));
    assert.ok(provDemo.json.data.temporaryPassword);
    assert.equal(provDemo.json.data.admin.dsaId, demo.id);
    demoPassword = provDemo.json.data.temporaryPassword;

    const provSample = await httpJson(
      port,
      'POST',
      `/api/apl-admin/dsas/${sample.id}/admins`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: {
          name: 'Sample Admin',
          email: sampleEmail,
          roleCode: 'DSA_OWNER',
        },
      },
    );
    assert.equal(provSample.status, 200, JSON.stringify(provSample.json));
    samplePassword = provSample.json.data.temporaryPassword;

    const listAdmins = await httpJson(
      port,
      'GET',
      `/api/apl-admin/dsas/${demo.id}/admins`,
      { headers: { Authorization: `Bearer ${aplToken}` } },
    );
    assert.equal(listAdmins.status, 200);
    assert.equal(listAdmins.json.data.items.length, 1);

    const demoLogin = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: demoEmail, password: demoPassword },
    });
    assert.equal(demoLogin.status, 200, JSON.stringify(demoLogin.json));
    demoAdminToken = demoLogin.json.data.token;
    assert.equal(demoLogin.json.data.user.dsaId, demo.id);

    const sampleLogin = await httpJson(
      port,
      'POST',
      '/api/dsa-admin/auth/login',
      { body: { email: sampleEmail, password: samplePassword } },
    );
    assert.equal(sampleLogin.status, 200);
    sampleAdminToken = sampleLogin.json.data.token;
    assert.equal(sampleLogin.json.data.user.dsaId, sample.id);
  });

  it('15C.4 DSA configures CMS/services; client dsaId spoof ignored', async () => {
    const brand = await httpJson(port, 'PATCH', '/api/dsa-admin/website-settings', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
      body: {
        websiteName: 'Demo Brand Portal',
        primaryColor: '#0c4a6e',
        dsaId: sample.id, // spoof attempt — must not switch tenant
      },
    });
    assert.equal(brand.status, 200, JSON.stringify(brand.json));
    assert.equal(brand.json.data.settings.websiteName, 'Demo Brand Portal');

    const settingsDoc = await WebsiteSettings.findOne({ dsaId: demo.id }).lean();
    assert.equal(settingsDoc.websiteName, 'Demo Brand Portal');
    const leaked = await WebsiteSettings.findOne({
      dsaId: sample.id,
      websiteName: 'Demo Brand Portal',
    }).lean();
    assert.equal(leaked, null);

    await httpJson(port, 'PATCH', '/api/dsa-admin/website-settings', {
      headers: { Authorization: `Bearer ${sampleAdminToken}` },
      body: { websiteName: 'Sample Brand Portal', primaryColor: '#14532d' },
    });

    const services = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
    });
    assert.equal(services.status, 200);
    const rows = services.json.data.services || [];
    const flight = rows.find((r) => r.service.code === 'flight');
    const hotel = rows.find((r) => r.service.code === 'hotel');
    const bus = rows.find((r) => r.service.code === 'bus');
    const transfer = rows.find((r) => r.service.code === 'transfer');
    assert.equal(flight.mapping.isAllowedByAPL, true);
    assert.equal(hotel.mapping.isAllowedByAPL, false);
    assert.equal(bus.mapping.isAllowedByAPL, true);
    assert.equal(transfer.mapping.isAllowedByAPL, false);

    // Activate Flight+Bus; Hotel blocked by APL
    const actFlight = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${flight.service.id}`,
      {
        headers: { Authorization: `Bearer ${demoAdminToken}` },
        body: { isActiveByDSA: true },
      },
    );
    assert.equal(actFlight.status, 200);
    const actBus = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${bus.service.id}`,
      {
        headers: { Authorization: `Bearer ${demoAdminToken}` },
        body: { isActiveByDSA: true },
      },
    );
    assert.equal(actBus.status, 200);
    const actHotel = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${hotel.service.id}`,
      {
        headers: { Authorization: `Bearer ${demoAdminToken}` },
        body: { isActiveByDSA: true },
      },
    );
    assert.equal(actHotel.status, 403);

    // Sample activates hotel+transfer
    const sampleServices = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      headers: { Authorization: `Bearer ${sampleAdminToken}` },
    });
    const sHotel = sampleServices.json.data.services.find(
      (r) => r.service.code === 'hotel',
    );
    const sXfer = sampleServices.json.data.services.find(
      (r) => r.service.code === 'transfer',
    );
    assert.equal(
      (
        await httpJson(
          port,
          'PATCH',
          `/api/dsa-admin/services/${sHotel.service.id}`,
          {
            headers: { Authorization: `Bearer ${sampleAdminToken}` },
            body: { isActiveByDSA: true },
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await httpJson(
          port,
          'PATCH',
          `/api/dsa-admin/services/${sXfer.service.id}`,
          {
            headers: { Authorization: `Bearer ${sampleAdminToken}` },
            body: { isActiveByDSA: true },
          },
        )
      ).status,
      200,
    );

    const markup = await httpJson(port, 'PUT', '/api/dsa-admin/pricing/markup', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
      body: {
        serviceCode: 'flight',
        adjustmentType: 'PERCENTAGE',
        value: 5,
      },
    });
    assert.equal(markup.status, 200, JSON.stringify(markup.json));
  });

  it('15C.4–15C.5 host resolution, service isolation, transaction dsaId', async () => {
    const demoHost = `e2e-demo-${stamp}.localhost:3001`;
    const sampleHost = `e2e-sample-${stamp}.localhost:3001`;

    const demoSite = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: tenantHeaders(demoHost),
    });
    assert.equal(demoSite.status, 200, JSON.stringify(demoSite.json));
    assert.match(
      String(demoSite.json.data.branding?.websiteName || ''),
      /Demo Brand/,
    );
    const demoCodes = (demoSite.json.data.services || []).map((s) => s.code || s.id);
    assert.ok(demoCodes.includes('flight') || demoCodes.includes('bus'));
    assert.equal(demoCodes.includes('hotel'), false);
    assert.equal(demoCodes.includes('transfer'), false);

    const sampleSite = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: tenantHeaders(sampleHost),
    });
    assert.equal(sampleSite.status, 200);
    assert.match(
      String(sampleSite.json.data.branding?.websiteName || ''),
      /Sample Brand/,
    );

    const flightOk = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(demoHost, { 'X-Request-Id': `p15c-f-${stamp}` }),
      body: {
        tripType: 'ONEWAY',
        origin: 'DEL',
        destination: 'BOM',
        departureDate: travelDate,
        adults: 1,
        cabinClass: 'ECONOMY',
      },
    });
    // Accept 200 success or validation variants, but not tenant/service forbid
    assert.notEqual(flightOk.status, 403);
    assert.notEqual(flightOk.json?.error?.code, 'FORBIDDEN');

    if (flightOk.status === 200 && flightOk.json?.data?.searchId) {
      const search = await Search.findOne({
        aplSearchId: flightOk.json.data.searchId,
      }).lean();
      assert.ok(search, 'search row missing');
      assert.equal(String(search.dsaId), String(demo.id));
    }

    const flightDeniedSample = await httpJson(
      port,
      'POST',
      '/api/v1/flights/search',
      {
        headers: tenantHeaders(sampleHost),
        body: {
          tripType: 'ONEWAY',
          origin: 'DEL',
          destination: 'BOM',
          departureDate: travelDate,
          adults: 1,
          cabinClass: 'ECONOMY',
        },
      },
    );
    assert.equal(flightDeniedSample.status, 403);

    const busOk = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(demoHost),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.equal(busOk.status, 200, JSON.stringify(busOk.json));
    assert.ok(busOk.json.data.searchId);
    const busSearch = await Search.findOne({
      aplSearchId: busOk.json.data.searchId,
    }).lean();
    assert.ok(busSearch, 'bus search row missing');
    assert.equal(String(busSearch.dsaId), String(demo.id));

    // Spoof body dsaId to sample — must still book under demo host
    const bus = busOk.json.data.buses[0];
    const offer = bus.primaryOffer || bus.offers[0];
    const boarding = offer.boardingPoints[0];
    const dropping = offer.droppingPoints[0];
    const available =
      (offer.availableSeats || offer.seats || []).map((s) => s.code || s).filter(Boolean);
    const selectedSeats = available.length ? available.slice(0, 1) : ['1B'];
    const confirmPrice = {
      amount: Number(offer.price.amount) * selectedSeats.length,
      currency: offer.price.currency,
    };
    const checkout = await httpJson(port, 'POST', '/api/v1/buses/checkout', {
      headers: tenantHeaders(demoHost),
      body: {
        searchId: busOk.json.data.searchId,
        aplBusId: bus.aplBusId,
        aplOfferId: offer.aplOfferId,
        selectedSeats,
        boardingPointCode: boarding.code,
        droppingPointCode: dropping.code,
        confirmPrice,
        dsaId: sample.id,
        contact: { email: 'p15c@example.com', phone: '9333333333' },
        travellers: selectedSeats.map((seat, i) => ({
          type: 'ADULT',
          title: 'Mr',
          firstName: `Iso${i + 1}`,
          lastName: 'Test',
          age: 30,
          seat,
        })),
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.json));

    const book = await httpJson(port, 'POST', '/api/v1/buses/book', {
      headers: tenantHeaders(demoHost, {
        Authorization: `Bearer ${userToken}`,
      }),
      body: {
        checkoutToken: checkout.json.data.checkoutToken,
        confirmPrice,
        dsaId: sample.id,
        payment: {
          method: 'CARD',
          cardNumber: '4111111111111111',
          idempotencyKey: `p15c-pay-${stamp}`,
        },
      },
    });
    assert.equal(book.status, 200, JSON.stringify(book.json));
    bookingRef = book.json.data.aplBookingRef;
    assert.equal(String(book.json.data.dsaId), String(demo.id));
  });

  it('15C.6 booking + CMS isolation across DSA admins', async () => {
    const demoBookings = await httpJson(port, 'GET', '/api/dsa-admin/bookings', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
    });
    assert.equal(demoBookings.status, 200);
    const demoItems =
      demoBookings.json.data.items || demoBookings.json.data.bookings || [];
    assert.ok(
      demoItems.some(
        (b) => b.aplBookingRef === bookingRef || b.bookingRef === bookingRef,
      ),
    );

    const sampleBookings = await httpJson(
      port,
      'GET',
      '/api/dsa-admin/bookings',
      { headers: { Authorization: `Bearer ${sampleAdminToken}` } },
    );
    assert.equal(sampleBookings.status, 200);
    const sampleItems =
      sampleBookings.json.data.items || sampleBookings.json.data.bookings || [];
    assert.equal(
      sampleItems.some(
        (b) => b.aplBookingRef === bookingRef || b.bookingRef === bookingRef,
      ),
      false,
    );

    const sampleGet = await httpJson(
      port,
      'GET',
      `/api/dsa-admin/bookings/${bookingRef}`,
      { headers: { Authorization: `Bearer ${sampleAdminToken}` } },
    );
    assert.ok(sampleGet.status === 403 || sampleGet.status === 404);

    const aplGet = await httpJson(
      port,
      'GET',
      `/api/apl-admin/bookings/${bookingRef}`,
      { headers: { Authorization: `Bearer ${aplToken}` } },
    );
    assert.equal(aplGet.status, 200, JSON.stringify(aplGet.json));

    // Cross-tenant service mutation denied (sample cannot touch demo services list identity)
    const demoServices = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
    });
    const flight = demoServices.json.data.services.find(
      (r) => r.service.code === 'flight',
    );
    const cross = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${flight.service.id}`,
      {
        headers: { Authorization: `Bearer ${sampleAdminToken}` },
        body: { isActiveByDSA: false, dsaId: demo.id },
      },
    );
    // Sample may not be allowed flight — must not mutate demo mapping
    const mapping = await DsaService.findOne({
      dsaId: demo.id,
      serviceId: flight.service.id,
    }).lean();
    assert.equal(mapping.isActiveByDSA, true);
    assert.ok(cross.status === 403 || cross.status === 200);
    if (cross.status === 200) {
      // If 200, it only mutated sample's own mapping (hotel path) — flight on demo stays active
      assert.equal(mapping.isActiveByDSA, true);
    }
  });

  it('15C.7 APL revoke Flight blocks DSA override and B2C API', async () => {
    const services = await httpJson(port, 'GET', '/api/apl-admin/services', {
      headers: { Authorization: `Bearer ${aplToken}` },
    });
    const flight = (services.json.data.services || []).find(
      (s) => s.code === 'flight',
    );
    const revoke = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${demo.id}/services/${flight.id}`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: { isAllowedByAPL: false },
      },
    );
    assert.equal(revoke.status, 200);

    const dsaView = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
    });
    const row = dsaView.json.data.services.find((r) => r.service.code === 'flight');
    assert.equal(row.mapping.isAllowedByAPL, false);
    assert.equal(row.effectiveOffered, false);

    const reactivate = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/services/${flight.id}`,
      {
        headers: { Authorization: `Bearer ${demoAdminToken}` },
        body: { isActiveByDSA: true },
      },
    );
    assert.equal(reactivate.status, 403);

    const search = await httpJson(port, 'POST', '/api/v1/flights/search', {
      headers: tenantHeaders(`e2e-demo-${stamp}.localhost:3001`),
      body: {
        tripType: 'ONEWAY',
        origin: 'DEL',
        destination: 'BOM',
        departureDate: travelDate,
        adults: 1,
        cabinClass: 'ECONOMY',
      },
    });
    assert.equal(search.status, 403);

    // Restore
    await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${demo.id}/services/${flight.id}`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: { isAllowedByAPL: true },
      },
    );
    await httpJson(port, 'PATCH', `/api/dsa-admin/services/${flight.id}`, {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
      body: { isActiveByDSA: true },
    });
  });

  it('15C.8 suspension fails closed for public + DSAAdmin login', async () => {
    const susp = await httpJson(
      port,
      'PATCH',
      `/api/apl-admin/dsas/${demo.id}/status`,
      {
        headers: { Authorization: `Bearer ${aplToken}` },
        body: { status: 'SUSPENDED' },
      },
    );
    assert.equal(susp.status, 200);

    const site = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: tenantHeaders(`e2e-demo-${stamp}.localhost:3001`),
    });
    assert.equal(site.status, 403);

    const bus = await httpJson(port, 'POST', '/api/v1/buses/search', {
      headers: tenantHeaders(`e2e-demo-${stamp}.localhost:3001`),
      body: {
        origin: 'New York',
        destination: 'Boston',
        travelDate,
      },
    });
    assert.ok(bus.status === 403 || bus.status === 401);

    const me = await httpJson(port, 'GET', '/api/dsa-admin/profile', {
      headers: { Authorization: `Bearer ${demoAdminToken}` },
    });
    assert.equal(me.status, 401);

    const login = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: {
        email: `e2e.demo.admin.${stamp}@example.test`,
        password: demoPassword,
      },
    });
    assert.ok(
      login.status === 401 || login.json?.success === false,
      JSON.stringify(login.json),
    );

    // Restore
    await httpJson(port, 'PATCH', `/api/apl-admin/dsas/${demo.id}/status`, {
      headers: { Authorization: `Bearer ${aplToken}` },
      body: { status: 'ACTIVE' },
    });
  });
});
