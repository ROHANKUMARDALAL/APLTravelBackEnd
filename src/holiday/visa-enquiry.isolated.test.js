'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26p';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../common/database/connection');
const { Enquiry } = require('../../packages/shared-domain/models');
const { submitEnquiry, getEnquiry, listEnquiries, listCustomerEnquiries, updateEnquiry } = require('../../packages/shared-domain/services/enquiry-store');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26p';

function visaBody(key = 'visa-26o') {
  return {
    serviceCode: 'visa',
    visaType: 'TOURIST',
    destinationIso: 'JP',
    destinationCountry: 'Japan',
    preferredDepartureDate: '2030-08-01',
    durationDays: 10,
    travellerCount: 1,
    idempotencyKey: key,
    travellers: [{
      title: 'Mr', firstName: 'Asha', lastName: 'Mehta', dateOfBirth: '1992-02-02',
      gender: 'FEMALE', nationality: 'India', nationalityIso: 'IN',
      phone: '+919876543210', email: 'asha26o@example.com',
      passportNumber: 'Z9876543', passportExpiry: '2034-01-01',
    }],
  };
}

describe('visa enquiry', () => {
  const dsaId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const customer = { id: new mongoose.Types.ObjectId(), name: 'Asha Mehta', email: 'asha26o@example.com', phone: '9876543210' };
  const membership = { id: new mongoose.Types.ObjectId(), customerCode: 'C26O' };

  before(async () => {
    if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing to run outside apl_test_phase26p');
    await connectDatabase();
    if (mongoose.connection.name !== 'apl_test_phase26p') throw new Error('Wrong database');
    await mongoose.connection.db.dropDatabase();
  });

  after(async () => {
    if (mongoose.connection.name === 'apl_test_phase26p') await mongoose.connection.db.dropDatabase();
    await disconnectDatabase();
  });

  it('stores one visa enquiry, masks the passport, and rejects another DSA', async () => {
    const created = await submitEnquiry({
      dsaId, serviceCode: 'visa', customer, membership,
      dsaSnapshot: { dsaCode: 'APL-DSA-2602', dsaName: 'Phase 26O' },
      body: visaBody(),
    });
    assert.equal(created.created, true);
    assert.equal(created.enquiry.status, 'NEW');
    assert.equal(created.enquiry.serviceCode, 'visa');
    assert.equal(created.enquiry.visaDetails.destinationIso, 'JP');
    assert.equal(created.enquiry.passengers[0].document.number, undefined);
    assert.match(created.enquiry.passengers[0].document.maskedNumber, /6543$/);
    const replay = await submitEnquiry({
      dsaId, serviceCode: 'visa', customer, membership, body: visaBody(),
    });
    assert.equal(replay.created, false);
    assert.equal(await Enquiry.countDocuments({ dsaId }), 1);
    await assert.rejects(() => getEnquiry({ dsaId: otherId, enquiryId: created.enquiry.id }), /not found/i);
    const stored = await Enquiry.findOne({ enquiryReference: created.enquiry.enquiryReference }).lean();
    assert.equal(stored.passengers[0].document.numberEnc.includes('Z9876543'), false);
    assert.equal(stored.dsaCode, 'APL-DSA-2602');
    const listed = await listEnquiries({ dsaId, query: { serviceCode: 'visa' } });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].visaDetails.destinationCountry, 'Japan');
    assert.equal(listed[0].passengers[0].document.number, undefined);
    assert.equal((await listEnquiries({ dsaId: otherId, query: { serviceCode: 'visa' } })).length, 0);
    const mine = await listCustomerEnquiries({ dsaId, customerId: customer.id });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].enquiryReference, created.enquiry.enquiryReference);
    const updated = await updateEnquiry({
      dsaId, enquiryId: created.enquiry.id, allowWorkflow: true,
      actor: { id: 'staff', name: 'Desk' },
      patch: { status: 'CONTACTED', assignedTo: 'Neha', adminNotes: 'Called', customerVisibleRemarks: 'We received this' },
    });
    assert.equal(updated.status, 'CONTACTED');
    await assert.rejects(() => updateEnquiry({
      dsaId: otherId, enquiryId: created.enquiry.id, allowWorkflow: true, actor: { id: 'x' }, patch: { status: 'CLOSED' },
    }), /not found/i);
  });
});
