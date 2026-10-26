'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase21b';
process.env.PUBLIC_DEV_HOST_MAP = 'phase21b.localhost=APL-DSA-2181,other21b.localhost=APL-DSA-2182';
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
const ServiceLog = require('../common/database/models/ServiceLog');
const { Booking } = require('../common/database/models/Booking');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { ensureMembership } = require('../customer/services/membership.service');
const crypto = require('crypto');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase21b';
const HOST = 'phase21b.localhost';
let server;
let token;
let dsaId;
let otherDsaId;

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing to run outside apl_test_phase21b');
}

function captchaAnswer(image) {
  const svg = Buffer.from(String(image).split(',')[1], 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<])<\/text>/g)].map((match) => match[1]).join('');
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

const adult = {
  firstName: 'Ava',
  lastName: 'Tester',
  dob: '1992-04-02',
  mobile: '9990002181',
  email: 'ava21b@example.test',
  address: '12 Harbor Road',
  nationality: 'Indian',
  beneficiary: {
    firstName: 'Ravi',
    lastName: 'Tester',
    relationship: 'Spouse',
    dob: '1990-02-02',
    mobile: '9990002182',
    email: 'ravi21b@example.test',
    address: '12 Harbor Road',
  },
};

const child = {
  ...adult,
  firstName: 'Mia',
  lastName: 'Tester',
  dob: '2018-06-01',
  email: 'mia21b@example.test',
  beneficiary: {
    firstName: 'Ava',
    lastName: 'Tester',
    relationship: 'Parent',
    dob: '1992-04-02',
    mobile: '9990002181',
    email: 'ava21b@example.test',
    address: '12 Harbor Road',
  },
};

describe('phase 21b insurance demo booking', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2181', companyName: 'Phase 21B', displayName: 'Phase 21B',
      ownerName: 'Owner', email: 'owner21b@example.test', phone: '9990002183', subdomain: 'phase21b', status: 'ACTIVE',
    });
    const other = await Dsa.create({
      dsaCode: 'APL-DSA-2182', companyName: 'Other 21B', displayName: 'Other 21B',
      ownerName: 'Other', email: 'other21b@example.test', phone: '9990002184', subdomain: 'other21b', status: 'ACTIVE',
    });
    dsaId = dsa._id;
    otherDsaId = other._id;
    const insurance = await Service.findOne({ code: 'insurance' });
    await DsaService.create({ dsaId, serviceId: insurance._id, isAllowedByAPL: true, isActiveByDSA: true });
    await DsaService.create({ dsaId: otherDsaId, serviceId: insurance._id, isAllowedByAPL: true, isActiveByDSA: true });
    const salt = crypto.randomBytes(16).toString('hex');
    const user = await User.create({
      name: 'Phase Tester',
      email: 'phase21b-user@example.test',
      phoneNumber: '9990002185',
      passwordHash: `${salt}:${crypto.scryptSync('Test-pass-21b', salt, 32).toString('hex')}`,
      currency: 'INR',
    });
    await ensureMembership({ userId: user._id, dsaId });
    token = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('books one demo policy reference and replays the same booking', async () => {
    const searched = await json('POST', '/api/v1/insurance/search', {
      auth: token,
      body: {
        destination: 'United Arab Emirates',
        departureDate: '2026-12-01',
        returnDate: '2026-12-10',
        tripType: 'SINGLE',
        travellers: [{ type: 'ADULT', age: 34 }, { type: 'CHILD', age: 8 }],
      },
    });
    assert.equal(searched.status, 200, JSON.stringify(searched.payload));
    const searchId = searched.payload.data.searchId;
    const plan = searched.payload.data.plans.find((row) => row.id === 'MOCK-SHIELD-PLUS');
    assert.ok(plan);
    assert.equal(plan.purchaseEnabled, false);

    const rejected = await json('POST', '/api/v1/insurance/travellers', {
      auth: token,
      body: { searchId, travellers: [{ firstName: 'Ava' }] },
    });
    assert.equal(rejected.status, 400);

    const accepted = await json('POST', '/api/v1/insurance/travellers', {
      auth: token,
      body: { searchId, sameBeneficiary: false, travellers: [adult, child] },
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
    assert.equal(accepted.payload.data.travellerCount, 2);

    const checkout = await json('POST', '/api/v1/insurance/checkout', {
      auth: token,
      body: {
        searchId,
        planId: plan.id,
        destination: 'United Arab Emirates',
        departureDate: '2026-12-01',
        returnDate: '2026-12-10',
        sameBeneficiary: false,
        travellers: [adult, child],
        confirmPrice: plan.premium,
        contact: { email: adult.email, phone: adult.mobile },
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.payload));
    const key = `pay:${checkout.payload.data.checkoutToken}`;
    const payment = {
      method: 'CARD',
      cardNumber: '4111111111114242',
      idempotencyKey: key,
    };
    const booked = await json('POST', '/api/v1/insurance/book', {
      auth: token,
      body: { checkoutToken: checkout.payload.data.checkoutToken, confirmPrice: plan.premium, payment, idempotencyKey: key },
    });
    assert.equal(booked.status, 200, JSON.stringify(booked.payload));
    assert.equal(booked.payload.data.demo, true);
    assert.equal(booked.payload.data.policyIssued, false);
    assert.equal(booked.payload.data.productType, 'INSURANCE');
    const again = await json('POST', '/api/v1/insurance/book', {
      auth: token,
      body: { checkoutToken: checkout.payload.data.checkoutToken, confirmPrice: plan.premium, payment, idempotencyKey: key },
    });
    assert.equal(again.payload.data.aplBookingRef, booked.payload.data.aplBookingRef);
    assert.equal(again.payload.data.idempotentReplay, true);
    const count = await Booking.countDocuments({ aplBookingRef: booked.payload.data.aplBookingRef });
    assert.equal(count, 1);

    const logs = await ServiceLog.find({ journeyId: searchId, dsaId }).lean();
    const ops = new Set(logs.map((row) => row.businessOperation));
    for (const name of ['SEARCH', 'VALIDATE', 'CHECKOUT', 'PAYMENT', 'BOOK']) {
      assert.ok(ops.has(name), `missing ${name}: ${[...ops].join(',')}`);
    }
    const serialized = JSON.stringify(logs);
    assert.equal(serialized.includes('ava21b@example.test'), false);
    assert.equal(serialized.includes('4111111111114242'), false);
    const otherLogs = await ServiceLog.countDocuments({ journeyId: searchId, dsaId: otherDsaId });
    assert.equal(otherLogs, 0);
    const foreign = await json('POST', '/api/v1/insurance/details', {
      host: 'other21b.localhost',
      body: { planId: plan.id, searchId },
    });
    assert.equal(foreign.status, 200);
    const leaked = await ServiceLog.countDocuments({ journeyId: searchId, dsaId: otherDsaId, businessOperation: 'SEARCH' });
    assert.equal(leaked, 0);
  });
});
