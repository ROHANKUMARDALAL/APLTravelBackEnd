'use strict';

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../../common/database/connection');
const { seedMasterServices } = require('./seed-master-services');
const { createDsa } = require('./dsa.service');
const {
  upsertDsaServiceMapping,
} = require('./dsa-service-mapping.service');
const {
  evaluateServiceOffer,
  isServiceOffered,
} = require('./service-offer.service');
const DsaService = require('../models/DsaService');
const Service = require('../models/Service');
const Dsa = require('../models/Dsa');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

describeDb('tenant foundation integration', () => {
  let dsa;
  const createdDsaIds = [];

  before(async () => {
    await connectDatabase();
  });

  after(async () => {
    // Clean only documents created by this test run.
    if (createdDsaIds.length) {
      await DsaService.deleteMany({ dsaId: { $in: createdDsaIds } });
      await Dsa.deleteMany({ _id: { $in: createdDsaIds } });
    }
    await disconnectDatabase();
  });

  it('represents DSA and master Service correctly', async () => {
    const seeded = await seedMasterServices();
    assert.ok(seeded.some((row) => row.code === 'flight'));
    assert.ok(seeded.some((row) => row.code === 'hotel'));
    assert.ok(seeded.some((row) => row.code === 'bus'));
    assert.ok(seeded.some((row) => row.code === 'transfer'));

    dsa = await createDsa({
      companyName: 'Phase3 Test Travels',
      displayName: 'Phase3 Test',
      ownerName: 'Test Owner',
      email: `phase3-test-${Date.now()}@example.com`,
      phone: '+91 9000000000',
      subdomain: `phase3-${Date.now()}`,
    });
    createdDsaIds.push(dsa._id);
    assert.match(dsa.dsaCode, /^APL-DSA-\d{4,}$/);
    assert.equal(dsa.status, 'ACTIVE');

    const flight = await Service.findOne({ code: 'flight' }).lean();
    assert.ok(flight);
    assert.equal(flight.slug, 'flight');
  });

  it('prevents duplicate DsaService mappings via unique index', async () => {
    assert.ok(dsa);
    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'flight',
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'flight',
      isAllowedByAPL: true,
      isActiveByDSA: false,
    });
    const count = await DsaService.countDocuments({
      dsaId: dsa._id,
      serviceId: (await Service.findOne({ code: 'flight' }).lean())._id,
    });
    assert.equal(count, 1);
  });

  it('offer evaluation follows the central availability rule', async () => {
    assert.ok(dsa);
    const flight = await Service.findOne({ code: 'flight' });
    const hotel = await Service.findOne({ code: 'hotel' });

    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'flight',
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    let result = await evaluateServiceOffer({
      dsaId: dsa._id,
      serviceCode: 'flight',
    });
    assert.equal(result.offered, true);

    // Global inactive
    const previousFlightStatus = flight.globalStatus;
    flight.globalStatus = 'INACTIVE';
    await flight.save();
    result = await evaluateServiceOffer({ dsaId: dsa._id, serviceCode: 'flight' });
    assert.equal(result.offered, false);
    assert.equal(result.reason, 'SERVICE_GLOBALLY_INACTIVE');
    flight.globalStatus = previousFlightStatus;
    await flight.save();

    // DSA inactive
    await Dsa.updateOne({ _id: dsa._id }, { $set: { status: 'SUSPENDED' } });
    result = await evaluateServiceOffer({ dsaId: dsa._id, serviceCode: 'flight' });
    assert.equal(result.offered, false);
    assert.equal(result.reason, 'DSA_INACTIVE');
    await Dsa.updateOne({ _id: dsa._id }, { $set: { status: 'ACTIVE' } });

    // Not allowed by APL
    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'hotel',
      isAllowedByAPL: false,
      isActiveByDSA: true,
    });
    result = await evaluateServiceOffer({ dsaId: dsa._id, serviceCode: 'hotel' });
    assert.equal(result.offered, false);
    assert.equal(result.reason, 'NOT_ALLOWED_BY_APL');
    assert.equal(result.mapping.isActiveByDSA, false);

    // Allowed but DSA inactive selection
    await upsertDsaServiceMapping({
      dsaId: dsa._id,
      serviceCode: 'hotel',
      isAllowedByAPL: true,
      isActiveByDSA: false,
    });
    result = await evaluateServiceOffer({ dsaId: dsa._id, serviceCode: 'hotel' });
    assert.equal(result.offered, false);
    assert.equal(result.reason, 'NOT_ACTIVE_BY_DSA');

    // Pure helper sanity
    assert.equal(
      isServiceOffered({
        dsa: { status: 'ACTIVE' },
        service: { globalStatus: hotel.globalStatus },
        mapping: { isAllowedByAPL: true, isActiveByDSA: true },
      }),
      hotel.globalStatus === 'ACTIVE',
    );
  });

  it('seedMasterServices is idempotent', async () => {
    const first = await seedMasterServices();
    const second = await seedMasterServices();
    assert.equal(first.length, second.length);
    const codes = (await Service.find({ code: { $in: ['flight', 'hotel', 'bus', 'transfer'] } }).lean()).map(
      (row) => row.code,
    );
    assert.deepEqual(codes.sort(), ['bus', 'flight', 'hotel', 'transfer']);
  });
});
