'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_holidayenq';
process.env.PUBLIC_DEV_HOST_MAP = 'holidayenq.localhost=APL-DSA-9001,otherenq.localhost=APL-DSA-9002,suspendenq.localhost=APL-DSA-9003';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { upsertDsaServiceMapping } = require('../tenant/services/dsa-service-mapping.service');
const { listOfferedServicesForDsa } = require('../tenant/services/service-offer.service');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const { HolidayPackage, Enquiry } = require('@apl/shared-domain/models');
const { holidayPackages, enquiries } = require('@apl/shared-domain');

const HOST = 'holidayenq.localhost';
const OTHER = 'otherenq.localhost';

function assertIsolatedUri() {
  const uri = String(process.env.APL_TEST_MONGODB_URI || '');
  if (!uri.startsWith('mongodb://127.0.0.1:27018/apl_test_holidayenq')) {
    throw new Error('Refusing to run outside the isolated holiday enquiry database');
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
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload };
}

async function signup(server, email, host) {
  const captcha = await json(server, 'GET', '/api/v1/auth/captcha', { host });
  assert.equal(captcha.status, 200);
  const created = await json(server, 'POST', '/api/v1/auth/signup', {
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
  if (created.status !== 200 && created.status !== 201) {
    const retryCaptcha = await json(server, 'GET', '/api/v1/auth/captcha', { host });
    const retry = await json(server, 'POST', '/api/v1/auth/signup', {
      host,
      body: {
        name: 'Rahul Sharma',
        email,
        phoneNumber: '9990001111',
        password: 'Test-pass-17h',
        currency: 'INR',
        captchaId: retryCaptcha.payload.data.captchaId,
        captchaAnswer: captchaAnswer(retryCaptcha.payload.data.image),
      },
    });
    assert.equal(retry.status, 200, retry.payload?.error?.ErrorMessage || 'signup failed');
    return retry.payload.data.token || retry.payload.data.loginToken;
  }
  return created.payload.data.token || created.payload.data.loginToken;
}

describe('holiday packages and enquiries', () => {
  let server;
  let dsa;
  let other;
  let suspended;

  before(async () => {
    assertIsolatedUri();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    dsa = await Dsa.create({
      dsaCode: 'APL-DSA-9001',
      companyName: 'Holiday One',
      displayName: 'Holiday One',
      ownerName: 'Owner One',
      email: 'holiday-one@example.test',
      phone: '9999999901',
      subdomain: 'holidayenq',
      status: 'ACTIVE',
    });
    other = await Dsa.create({
      dsaCode: 'APL-DSA-9002',
      companyName: 'Holiday Two',
      displayName: 'Holiday Two',
      ownerName: 'Owner Two',
      email: 'holiday-two@example.test',
      phone: '9999999902',
      subdomain: 'otherenq',
      status: 'ACTIVE',
    });
    suspended = await Dsa.create({
      dsaCode: 'APL-DSA-9003',
      companyName: 'Holiday Suspended',
      displayName: 'Holiday Suspended',
      ownerName: 'Owner Three',
      email: 'holiday-off@example.test',
      phone: '9999999903',
      subdomain: 'suspendenq',
      status: 'SUSPENDED',
    });
    for (const code of ['visa', 'transfer', 'holiday']) {
      await upsertDsaServiceMapping({
        dsaId: dsa._id,
        serviceCode: code,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
      await upsertDsaServiceMapping({
        dsaId: suspended._id,
        serviceCode: code,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }
    const app = createApp();
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
  });

  after(async () => {
    assertIsolatedUri();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('shows only effectively active services and keeps enquiries tenant scoped', async () => {
    const offered = (await listOfferedServicesForDsa(dsa._id)).map((row) => row.code).sort();
    assert.deepEqual(offered, ['holiday', 'transfer', 'visa']);
    assert.deepEqual(await listOfferedServicesForDsa(suspended._id), []);

    const site = await json(server, 'GET', '/api/v1/public/site/config');
    assert.equal(site.status, 200);
    const codes = site.payload.data.services.map((row) => row.code).sort();
    assert.deepEqual(codes, ['holiday', 'transfer', 'visa']);
    assert.equal(site.payload.data.services.find((row) => row.code === 'holiday').name, 'Holidays');
    assert.equal(site.payload.data.services.find((row) => row.code === 'transfer').name, 'Transfer (Cab)');
    assert.equal(site.payload.data.services.find((row) => row.code === 'holiday').serviceMode, 'ENQUIRY');

    const suspendedSite = await json(server, 'GET', '/api/v1/public/site/config', { host: 'suspendenq.localhost' });
    assert.equal(suspendedSite.status, 403);

    const draft = await holidayPackages.createHolidayPackage({
      dsaId: dsa._id,
      actorId: 'test',
      input: packageInput('Draft beach', false),
    });
    const published = await holidayPackages.createHolidayPackage({
      dsaId: dsa._id,
      actorId: 'test',
      input: packageInput('Goa published', false),
    });
    await holidayPackages.setHolidayPackageStatus({
      dsaId: dsa._id,
      packageId: published.id,
      actorId: 'test',
      status: 'PUBLISHED',
    });
    const abroad = await holidayPackages.createHolidayPackage({
      dsaId: dsa._id,
      actorId: 'test',
      input: packageInput('Singapore published', true),
    });
    await holidayPackages.setHolidayPackageStatus({
      dsaId: dsa._id,
      packageId: abroad.id,
      actorId: 'test',
      status: 'PUBLISHED',
    });
    const otherPackage = await holidayPackages.createHolidayPackage({
      dsaId: other._id,
      actorId: 'test',
      input: packageInput('Other DSA package', false),
    });
    await holidayPackages.setHolidayPackageStatus({
      dsaId: other._id,
      packageId: otherPackage.id,
      actorId: 'test',
      status: 'PUBLISHED',
    });

    const publicList = await json(server, 'GET', '/api/v1/holidays');
    assert.equal(publicList.status, 200);
    const titles = publicList.payload.data.packages.map((row) => row.title);
    assert.equal(titles.includes('Draft beach'), false);
    assert.equal(titles.includes('Goa published'), true);
    assert.equal(titles.includes('Singapore published'), true);
    assert.equal(titles.includes('Other DSA package'), false);

    const closed = await holidayPackages.createHolidayPackage({
      dsaId: dsa._id,
      actorId: 'test',
      input: { ...packageInput('Enquiry closed', false), enquiryEnabled: false },
    });
    await holidayPackages.setHolidayPackageStatus({
      dsaId: dsa._id,
      packageId: closed.id,
      actorId: 'test',
      status: 'PUBLISHED',
    });
    const openList = await json(server, 'GET', '/api/v1/holidays');
    const openTitles = openList.payload.data.packages.map((row) => row.title);
    assert.equal(openTitles.includes('Enquiry closed'), false);
    assert.equal(openTitles.includes('Goa published'), true);
    assert.equal(openTitles.includes('Singapore published'), true);

    const detail = await json(server, 'GET', `/api/v1/holidays/${published.slug}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.data.package.priceLabel, 'Indicative price');

    await assert.rejects(
      () => holidayPackages.getHolidayPackage({ dsaId: other._id, packageId: published.id }),
      (error) => error.httpStatus === 404,
    );

    const guest = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      body: enquiryBody(false),
    });
    assert.equal(guest.status, 401);

    const token = await signup(server, `rahul-${Date.now()}@example.test`, HOST);
    const otherToken = await signup(server, `other-${Date.now()}@example.test`, OTHER);
    const wrongTenant = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      host: HOST,
      token: otherToken,
      body: enquiryBody(false),
    });
    assert.equal(wrongTenant.status, 403);

    const mismatch = enquiryBody(false);
    mismatch.totalPassengers = 2;
    const badCount = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: mismatch,
    });
    assert.equal(badCount.status, 400);

    const domestic = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: enquiryBody(false),
    });
    assert.equal(domestic.status, 200);
    const reference = domestic.payload.data.enquiryReference;
    assert.match(reference, /^APL-ENQ-/);
    const repeat = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: enquiryBody(false),
    });
    assert.equal(repeat.payload.data.enquiryReference, reference);
    assert.equal(repeat.payload.data.created, false);

    const stored = await Enquiry.findOne({ enquiryReference: reference }).lean();
    assert.equal(stored.customerSnapshot.name, 'Rahul Sharma');
    assert.equal(stored.passengers[0].fullName, 'Amit Sharma');
    assert.equal(stored.contactDetails.name, 'Priya Mehta');
    assert.notEqual(stored.customerSnapshot.name, stored.passengers[0].fullName);

    const underAge = enquiryBody(false);
    underAge.idempotencyKey = 'idem-under-18';
    underAge.preferredDepartureDate = '2027-01-15';
    underAge.passengers[0].dateOfBirth = '2009-01-16';
    const underAgeResponse = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: underAge,
    });
    assert.equal(underAgeResponse.status, 400);

    const exactAge = enquiryBody(false);
    exactAge.idempotencyKey = 'idem-exact-18';
    exactAge.preferredDepartureDate = '2027-01-15';
    exactAge.passengers[0].dateOfBirth = '2009-01-15';
    exactAge.passengers[0].age = 40;
    const exactAgeResponse = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: exactAge,
    });
    assert.equal(exactAgeResponse.status, 200);
    const exactStored = await Enquiry.findOne({ enquiryReference: exactAgeResponse.payload.data.enquiryReference }).lean();
    assert.equal(exactStored.passengers[0].age, 18);

    const missingDob = enquiryBody(false);
    missingDob.idempotencyKey = 'idem-missing-dob';
    delete missingDob.passengers[0].dateOfBirth;
    const missingDobResponse = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: missingDob,
    });
    assert.equal(missingDobResponse.status, 400);

    const invalidDate = enquiryBody(false);
    invalidDate.idempotencyKey = 'idem-bad-date';
    invalidDate.preferredDepartureDate = 'not-a-date';
    const invalidDateResponse = await json(server, 'POST', `/api/v1/holidays/${published.slug}/enquiries`, {
      token,
      body: invalidDate,
    });
    assert.equal(invalidDateResponse.status, 400);
    assert.equal(String(stored.passengers[0].document.numberEnc).includes('123412341234'), false);
    assert.equal(stored.passengers[0].document.numberEnc.startsWith('enc:v1:'), true);

    const noPassport = await json(server, 'POST', `/api/v1/holidays/${abroad.slug}/enquiries`, {
      token,
      body: { ...enquiryBody(false), idempotencyKey: 'idem-abroad-bad' },
    });
    assert.equal(noPassport.status, 400);
    const withPassport = await json(server, 'POST', `/api/v1/holidays/${abroad.slug}/enquiries`, {
      token,
      body: { ...enquiryBody(true), idempotencyKey: 'idem-abroad-ok' },
    });
    assert.equal(withPassport.status, 200);

    await holidayPackages.updateHolidayPackage({
      dsaId: dsa._id,
      packageId: published.id,
      actorId: 'test',
      input: { ...packageInput('Renamed after enquiry', false), slug: published.slug },
    });
    const afterEdit = await Enquiry.findOne({ enquiryReference: reference }).lean();
    assert.equal(afterEdit.holidayPackageSnapshot.title, 'Goa published');

    const ownDetail = await enquiries.getEnquiry({ dsaId: dsa._id, enquiryId: stored._id });
    assert.equal(ownDetail.enquiryReference, reference);
    await assert.rejects(
      () => enquiries.getEnquiry({ dsaId: other._id, enquiryId: stored._id }),
      (error) => error.httpStatus === 404,
    );
    const summary = await enquiries.enquirySummary({ dsaId: dsa._id, query: {} });
    assert.equal(summary.total >= 2, true);
    assert.equal(typeof summary.quoted, 'number');

    const own = await enquiries.listEnquiries({ dsaId: dsa._id, query: {} });
    const foreign = await enquiries.listEnquiries({ dsaId: other._id, query: {} });
    assert.equal(own.some((row) => row.enquiryReference === reference), true);
    assert.equal(foreign.some((row) => row.enquiryReference === reference), false);
    const masked = own.find((row) => row.enquiryReference === reference);
    assert.equal(masked.passengers[0].document.maskedNumber.endsWith('1234'), true);
    assert.equal(masked.passengers[0].document.number, undefined);

    const updated = await enquiries.updateEnquiry({
      dsaId: dsa._id,
      enquiryId: stored._id,
      allowWorkflow: true,
      actor: { id: 'admin', name: 'DSA Admin' },
      patch: { status: 'CONTACTED', note: 'Called the customer' },
    });
    assert.equal(updated.status, 'CONTACTED');
    assert.equal(updated.activity.length >= 2, true);

    const aplFiltered = await enquiries.listEnquiries({ query: { dsaId: String(dsa._id) } });
    assert.equal(aplFiltered.every((row) => row.dsaId === String(dsa._id)), true);

    const mine = await json(server, 'GET', '/api/v1/enquiries/mine', { token });
    assert.equal(mine.status, 200);
    assert.equal(mine.payload.data.enquiries.some((row) => row.enquiryReference === reference), true);
    assert.equal(mine.payload.data.enquiries[0].adminNotes, undefined);

    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'transfer',
      isAllowedByAPL: true,
      isActiveByDSA: false,
    });
    const afterDeactivate = (await listOfferedServicesForDsa(dsa._id)).map((row) => row.code);
    assert.equal(afterDeactivate.includes('transfer'), false);

    await Service.updateOne({ code: 'visa' }, { $set: { globalStatus: 'INACTIVE' } });
    const afterGlobal = (await listOfferedServicesForDsa(dsa._id)).map((row) => row.code);
    assert.equal(afterGlobal.includes('visa'), false);

    const hiddenDraft = await json(server, 'GET', `/api/v1/holidays/${draft.slug}`);
    assert.equal(hiddenDraft.status, 404);
  });

  it('stores a transfer enquiry without a booking or payment', async () => {
    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'transfer',
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    const token = await signup(server, `transfer-${Date.now()}@example.test`, HOST);
    const created = await json(server, 'POST', '/api/v1/enquiries', {
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
        specialRequirements: 'Child seat',
        idempotencyKey: `transfer-${Date.now()}`,
      },
    });
    assert.equal(created.status, 200, created.payload?.error?.ErrorMessage || 'transfer enquiry failed');
    assert.equal(created.payload.data.status, 'NEW');
    assert.match(created.payload.data.enquiryReference, /^APL-ENQ-/);
    const mine = await json(server, 'GET', '/api/v1/enquiries/mine', { token });
    const saved = mine.payload.data.enquiries.find((row) => row.enquiryReference === created.payload.data.enquiryReference);
    assert.match(saved.specialRequirements, /Delhi Airport/);
    assert.match(saved.specialRequirements, /Sedan/);
    assert.equal(saved.totalPassengers, 2);
    const bookings = await mongoose.connection.collection('bookings').countDocuments({ dsaId: dsa._id });
    assert.equal(bookings, 0);
    const otherToken = await signup(server, `transfer-other-${Date.now()}@example.test`, OTHER);
    const denied = await json(server, 'GET', `/api/v1/enquiries/mine`, { token: otherToken, host: HOST });
    assert.equal(denied.status, 403);
  });
});

function packageInput(title, isInternational) {
  return {
    title,
    shortDescription: 'A published holiday outline',
    fullDescription: 'Day by day overview',
    destinationCity: isInternational ? 'Singapore' : 'Goa',
    destinationCountry: isInternational ? 'Singapore' : 'India',
    isInternational,
    durationDays: 5,
    durationNights: 4,
    startingPrice: 25000,
    currency: 'INR',
    priceType: 'INDICATIVE',
    highlights: ['Beach time'],
    inclusions: ['Hotel'],
    exclusions: ['Flights'],
    itinerary: [{ dayNumber: 1, title: 'Arrive', description: 'Transfer in', activities: ['Check in'] }],
  };
}

function enquiryBody(international) {
  return {
    preferredDepartureDate: '2030-06-01',
    durationDays: 5,
    adults: 1,
    children: 0,
    totalPassengers: 1,
    contactDetails: { name: 'Priya Mehta', mobile: '9990001111', email: 'rahul@example.test' },
    idempotencyKey: 'idem-domestic',
    passengers: [
      {
        fullName: 'Amit Sharma',
        dateOfBirth: '1990-01-01',
        nationality: 'Indian',
        document: international
          ? {
              type: 'PASSPORT',
              number: 'Z1234567',
              holderName: 'Amit Sharma',
              nationality: 'Indian',
              dateOfBirth: '1990-01-01',
              expiryDate: '2030-01-01',
              issuingCountry: 'India',
            }
          : { type: 'AADHAAR', number: '123412341234' },
      },
    ],
  };
}
