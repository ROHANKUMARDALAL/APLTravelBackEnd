'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase21g1';
process.env.PUBLIC_DEV_HOST_MAP = 'holidaycat.localhost=APL-DSA-9101,othercat.localhost=APL-DSA-9102';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const fs = require('fs');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { upsertDsaServiceMapping } = require('../tenant/services/dsa-service-mapping.service');
const Dsa = require('../tenant/models/Dsa');
const { Enquiry } = require('@apl/shared-domain/models');
const { holidayPackages, enquiries } = require('@apl/shared-domain');

const HOST = 'holidaycat.localhost';
const OTHER = 'othercat.localhost';

function assertIsolatedUri() {
  const uri = String(process.env.APL_TEST_MONGODB_URI || '');
  if (!uri.startsWith('mongodb://127.0.0.1:27018/apl_test_phase21g1')) {
    throw new Error('Refusing to run outside the isolated phase 21g1 database');
  }
}

function captchaAnswer(image) {
  const svg = Buffer.from(String(image).split(',')[1], 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<])<\/text>/g)].map((match) => match[1]).join('');
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
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

async function signup(server, email, host = HOST) {
  async function once() {
    const captcha = await json(server, 'GET', '/api/v1/auth/captcha', { host });
    return json(server, 'POST', '/api/v1/auth/signup', {
      host,
      body: {
        name: 'Rahul Sharma',
        email,
        phoneNumber: '9990001111',
        password: 'Test-pass-17h',
        currency: 'INR',
        captchaId: captcha.payload.data.captchaId,
        captchaAnswer: captchaAnswer(captcha.payload.data.image),
      },
    });
  }
  let created = await once();
  if (created.status !== 200 && created.status !== 201) created = await once();
  assert.equal(created.status, 200, created.payload?.error?.ErrorMessage || 'signup failed');
  return created.payload.data.loginToken || created.payload.data.token;
}

function packageInput(title, category) {
  return {
    title,
    shortDescription: 'A published holiday outline',
    destinationCity: 'Goa',
    destinationCountry: 'India',
    isInternational: false,
    durationDays: 5,
    durationNights: 4,
    startingPrice: 25000,
    currency: 'INR',
    priceType: 'FIXED',
    packageCategory: category,
    highlights: ['Beach time'],
    inclusions: ['Hotel'],
    itinerary: [{ dayNumber: 1, title: 'Arrive', description: 'Transfer in', activities: ['Check in'] }],
  };
}

function holidayBody(key) {
  return {
    preferredDepartureDate: '2030-06-01',
    durationDays: 5,
    adults: 1,
    children: 0,
    totalPassengers: 1,
    contactDetails: { name: 'Priya Mehta', mobile: '9990001111', email: 'rahul@example.test' },
    specialRequirements: 'group wording must not classify this',
    idempotencyKey: key,
    passengers: [{
      fullName: 'Amit Sharma',
      dateOfBirth: '1990-01-01',
      nationality: 'Indian',
      document: { type: 'AADHAAR', number: '123412341234' },
    }],
  };
}

describe('explicit enquiry categories', () => {
  let server;
  let dsa;
  let other;

  before(async () => {
    assertIsolatedUri();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    dsa = await Dsa.create({
      dsaCode: 'APL-DSA-9101',
      companyName: 'Category One',
      displayName: 'Category One',
      ownerName: 'Owner One',
      email: 'category-one@example.test',
      phone: '9999999911',
      subdomain: 'holidaycat',
      status: 'ACTIVE',
    });
    other = await Dsa.create({
      dsaCode: 'APL-DSA-9102',
      companyName: 'Category Two',
      displayName: 'Category Two',
      ownerName: 'Owner Two',
      email: 'category-two@example.test',
      phone: '9999999912',
      subdomain: 'othercat',
      status: 'ACTIVE',
    });
    for (const code of ['visa', 'transfer', 'holiday']) {
      await upsertDsaServiceMapping({
        dsaId: dsa._id,
        serviceCode: code,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }
    const app = createApp();
    const port = process.env.APL_KEEP_FIXTURE === '1' ? 3010 : 0;
    server = await new Promise((resolve) => {
      const listening = app.listen(port, '127.0.0.1', () => resolve(listening));
    });
  });

  after(async () => {
    assertIsolatedUri();
    if (process.env.APL_KEEP_FIXTURE === '1') return;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('keeps holiday, visa, group departure and transfer distinct and tenant scoped', async () => {
    const holidayPackage = await holidayPackages.createHolidayPackage({
      dsaId: dsa._id,
      actorId: 'test',
      input: packageInput('Fixed price holiday', 'HOLIDAY'),
    });
    const groupPackage = await holidayPackages.createHolidayPackage({
      dsaId: dsa._id,
      actorId: 'test',
      input: packageInput('Departing together', 'GROUP_DEPARTURE'),
    });
    await holidayPackages.setHolidayPackageStatus({ dsaId: dsa._id, packageId: holidayPackage.id, actorId: 'test', status: 'PUBLISHED' });
    await holidayPackages.setHolidayPackageStatus({ dsaId: dsa._id, packageId: groupPackage.id, actorId: 'test', status: 'PUBLISHED' });

    const email = `owner-${Date.now()}@example.test`;
    const token = await signup(server, email);
    const holiday = await json(server, 'POST', `/api/v1/holidays/${holidayPackage.slug}/enquiries`, { token, body: holidayBody('idem-holiday') });
    const group = await json(server, 'POST', `/api/v1/holidays/${groupPackage.slug}/enquiries`, { token, body: holidayBody('idem-group') });
    const visa = await json(server, 'POST', '/api/v1/enquiries', {
      token,
      body: {
        serviceCode: 'visa',
        preferredDepartureDate: '2030-06-01',
        contactDetails: { name: 'Priya Mehta', mobile: '9990001111', email: 'rahul@example.test' },
        idempotencyKey: 'idem-visa',
      },
    });
    const transfer = await json(server, 'POST', '/api/v1/enquiries', {
      token,
      body: {
        serviceCode: 'transfer',
        pickup: 'Delhi Airport',
        dropoff: 'The Leela Palace',
        pickupTime: '10:30',
        vehiclePreference: 'Sedan',
        passengers: 2,
        preferredDepartureDate: '2030-06-01',
        contactDetails: { name: 'Priya Mehta', mobile: '9990001111', email: 'rahul@example.test' },
        idempotencyKey: 'idem-transfer',
      },
    });
    assert.equal(holiday.status, 200, holiday.payload?.error?.ErrorMessage);
    assert.equal(group.status, 200, group.payload?.error?.ErrorMessage);
    assert.equal(visa.status, 200, visa.payload?.error?.ErrorMessage);
    assert.equal(transfer.status, 200, transfer.payload?.error?.ErrorMessage);

    const storedHoliday = await Enquiry.findOne({ enquiryReference: holiday.payload.data.enquiryReference }).lean();
    const storedGroup = await Enquiry.findOne({ enquiryReference: group.payload.data.enquiryReference }).lean();
    assert.equal(storedHoliday.serviceCode, 'holiday');
    assert.equal(storedHoliday.enquiryCategory, 'HOLIDAY');
    assert.equal(storedHoliday.holidayPackageSnapshot.priceType, 'FIXED');
    assert.equal(storedGroup.enquiryCategory, 'GROUP_DEPARTURE');
    assert.equal(storedGroup.serviceCode, 'holiday');

    await Enquiry.collection.insertOne({
      enquiryReference: 'APL-ENQ-HISTORICAL',
      dsaId: dsa._id,
      serviceCode: 'holiday',
      customerId: storedHoliday.customerId,
      holidayPackageSnapshot: { title: 'group tour', priceType: 'FIXED' },
      specialRequirements: 'group',
      status: 'NEW',
      passengers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mine = await json(server, 'GET', '/api/v1/enquiries/mine', { token });
    const rows = mine.payload.data.enquiries;
    const byRef = Object.fromEntries(rows.map((row) => [row.enquiryReference, row]));
    assert.equal(byRef[holiday.payload.data.enquiryReference].enquiryCategory, 'HOLIDAY');
    assert.equal(byRef[group.payload.data.enquiryReference].enquiryCategory, 'GROUP_DEPARTURE');
    assert.equal(byRef[visa.payload.data.enquiryReference].serviceCode, 'visa');
    assert.equal(byRef[visa.payload.data.enquiryReference].enquiryCategory || '', '');
    assert.equal(byRef[transfer.payload.data.enquiryReference].serviceCode, 'transfer');
    assert.match(byRef[transfer.payload.data.enquiryReference].specialRequirements, /Delhi Airport/);
    assert.equal(byRef['APL-ENQ-HISTORICAL'].enquiryCategory || '', '');
    assert.equal(byRef[holiday.payload.data.enquiryReference].passengers[0].fullName, 'Amit Sharma');
    assert.equal(byRef[holiday.payload.data.enquiryReference].adminNotes, undefined);

    const updated = await enquiries.updateEnquiry({
      dsaId: dsa._id,
      enquiryId: storedHoliday._id,
      allowWorkflow: true,
      actor: { id: 'staff', name: 'DSA Staff' },
      patch: {
        status: 'QUOTED',
        assignedTo: 'Neha',
        adminNotes: 'Internal quote',
        customerVisibleRemarks: 'Quoted at INR 25000',
        note: 'Quotation sent',
      },
    });
    assert.equal(updated.status, 'QUOTED');
    assert.equal(updated.activity.at(-1).toStatus, 'QUOTED');
    await assert.rejects(
      () => enquiries.getEnquiry({ dsaId: other._id, enquiryId: storedHoliday._id }),
      (error) => error.httpStatus === 404,
    );
    await assert.rejects(
      () => enquiries.updateEnquiry({
        dsaId: other._id,
        enquiryId: storedHoliday._id,
        allowWorkflow: true,
        actor: { id: 'staff' },
        patch: { status: 'CLOSED' },
      }),
      (error) => error.httpStatus === 404,
    );

    const after = await json(server, 'GET', '/api/v1/enquiries/mine', { token });
    const seen = after.payload.data.enquiries.find((row) => row.enquiryReference === holiday.payload.data.enquiryReference);
    assert.equal(seen.status, 'QUOTED');
    assert.equal(seen.customerVisibleRemarks, 'Quoted at INR 25000');
    assert.equal(seen.adminNotes, undefined);
    assert.equal(seen.timeline.some((item) => item.toStatus === 'QUOTED'), true);

    const stranger = await signup(server, `stranger-${Date.now()}@example.test`);
    const hidden = await json(server, 'GET', '/api/v1/enquiries/mine', { token: stranger });
    assert.equal(hidden.payload.data.enquiries.some((row) => row.enquiryReference === holiday.payload.data.enquiryReference), false);
    const otherHost = await signup(server, `other-${Date.now()}@example.test`, OTHER);
    const denied = await json(server, 'GET', '/api/v1/enquiries/mine', { token: otherHost, host: HOST });
    assert.equal(denied.status, 403);

    const apl = await enquiries.listEnquiries({ query: {} });
    assert.equal(apl.some((row) => row.enquiryReference === storedGroup.enquiryReference), true);
    const foreign = await enquiries.listEnquiries({ dsaId: other._id, query: {} });
    assert.equal(foreign.some((row) => row.enquiryReference === storedGroup.enquiryReference), false);
    if (process.env.APL_KEEP_FIXTURE === '1') {
      fs.writeFileSync('/tmp/phase21g1-enquiry.json', JSON.stringify({
        token,
        email,
        holiday: holiday.payload.data.enquiryReference,
        group: group.payload.data.enquiryReference,
        port: server.address().port,
      }));
    }
  });
});
