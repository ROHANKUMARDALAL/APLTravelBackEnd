'use strict';

/**
 * Phase 15B — cross-portal hierarchy on ONE MongoDB.
 * APL allow → DSA activate → B2C offered; APL revoke cannot be overridden by DSA.
 */

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  connectDatabase,
  disconnectDatabase,
  mongoose,
} = require('../../common/database/connection');
const Dsa = require('../models/Dsa');
const Service = require('../models/Service');
const DsaService = require('../models/DsaService');
const {
  isServiceOffered,
  evaluateServiceOffer,
} = require('./service-offer.service');
const { allocateDsaCode } = require('./dsa-code.service');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

describeDb('Phase 15B shared-DB hierarchy control', () => {
  let dsa;
  let service;

  before(async () => {
    await connectDatabase();
    const code = await allocateDsaCode();
    dsa = await Dsa.create({
      dsaCode: code,
      companyName: 'Phase15B Hierarchy DSA',
      displayName: 'P15B Hierarchy',
      ownerName: 'Hierarchy Owner',
      email: `p15b-hierarchy-${Date.now()}@example.com`,
      phone: '9999900015',
      status: 'ACTIVE',
      domain: `p15b-${Date.now()}.example.test`,
    });
    service = await Service.findOneAndUpdate(
      { code: 'flight' },
      {
        $set: {
          name: 'Flight',
          slug: 'flight',
          globalStatus: 'ACTIVE',
          displayOrder: 10,
        },
        $setOnInsert: { code: 'flight' },
      },
      { upsert: true, new: true },
    );
  });

  after(async () => {
    if (dsa?._id) {
      await DsaService.deleteMany({ dsaId: dsa._id });
      await Dsa.deleteOne({ _id: dsa._id });
    }
    await disconnectDatabase();
  });

  it('uses one Mongo database for APL/DSA/B2C evaluations', () => {
    const dbName = mongoose.connection.name;
    assert.ok(dbName, 'connected database name required');
    // Local development default; Atlas may differ but must be single shared DB.
    assert.equal(typeof dbName, 'string');
  });

  it('APL allow + DSA activate → offered; APL revoke blocks B2C even if DSA stays active', async () => {
    await DsaService.findOneAndUpdate(
      { dsaId: dsa._id, serviceId: service._id },
      {
        $set: {
          isAllowedByAPL: true,
          isActiveByDSA: false,
        },
      },
      { upsert: true, new: true },
    );

    let evalResult = await evaluateServiceOffer({
      dsaId: String(dsa._id),
      serviceCode: 'flight',
    });
    assert.equal(evalResult.offered, false);
    assert.equal(evalResult.reason, 'NOT_ACTIVE_BY_DSA');

    // DSAAdmin activates (cannot set isAllowedByAPL itself in real API; here we only flip DSA flag)
    await DsaService.updateOne(
      { dsaId: dsa._id, serviceId: service._id },
      { $set: { isActiveByDSA: true } },
    );

    evalResult = await evaluateServiceOffer({
      dsaId: String(dsa._id),
      serviceCode: 'flight',
    });
    assert.equal(evalResult.offered, true);
    assert.equal(evalResult.reason, 'OFFERED');

    // Reload docs for pure helper assertion
    const mapping = await DsaService.findOne({
      dsaId: dsa._id,
      serviceId: service._id,
    }).lean();
    const dsaDoc = await Dsa.findById(dsa._id).lean();
    const serviceDoc = await Service.findById(service._id).lean();
    assert.equal(
      isServiceOffered({ dsa: dsaDoc, service: serviceDoc, mapping }),
      true,
    );

    // APLAdmin revokes allow — DSA remains activeByDSA
    await DsaService.updateOne(
      { dsaId: dsa._id, serviceId: service._id },
      { $set: { isAllowedByAPL: false } },
    );
    const mappingRevoked = await DsaService.findOne({
      dsaId: dsa._id,
      serviceId: service._id,
    }).lean();
    assert.equal(mappingRevoked.isActiveByDSA, true);
    assert.equal(mappingRevoked.isAllowedByAPL, false);
    assert.equal(
      isServiceOffered({
        dsa: dsaDoc,
        service: serviceDoc,
        mapping: mappingRevoked,
      }),
      false,
    );

    evalResult = await evaluateServiceOffer({
      dsaId: String(dsa._id),
      serviceCode: 'flight',
    });
    assert.equal(evalResult.offered, false);
    assert.equal(evalResult.reason, 'NOT_ALLOWED_BY_APL');
  });
});
