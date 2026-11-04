'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26m';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const Dsa = require('../tenant/models/Dsa');
const User = require('../user/models/User');
const Testimonial = require('../cms/models/Testimonial');
const { createSupportRequest, listForCustomer, listForDsa, updateForDsa } = require('./support-request.service');
const { createCustomerReview } = require('../cms/services/testimonial.service');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26m';

describe('customer support and reviews', () => {
  let dsa;
  let other;
  let user;

  before(async () => {
    if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing to run outside apl_test_phase26m');
    await connectDatabase();
    if (mongoose.connection.name !== 'apl_test_phase26m') throw new Error('Wrong database');
    await mongoose.connection.db.dropDatabase();
    dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2602', companyName: 'Phase 26M', displayName: 'Phase 26M',
      ownerName: 'Owner', email: 'phase26m@example.com', phone: '9999999999', status: 'ACTIVE',
    });
    other = await Dsa.create({
      dsaCode: 'APL-DSA-2603', companyName: 'Other Desk', displayName: 'Other Desk',
      ownerName: 'Owner', email: 'other26m@example.com', phone: '9999999998', status: 'ACTIVE',
    });
    user = await User.create({
      name: 'Asha Mehta', email: 'asha26m@example.com', phoneNumber: '9876543210',
      passwordHash: 'test-hash', currency: 'INR',
    });
  });

  after(async () => {
    if (mongoose.connection.name === 'apl_test_phase26m') await mongoose.connection.db.dropDatabase();
    await disconnectDatabase();
  });

  it('stores a support request and hides internal notes from the customer', async () => {
    const created = await createSupportRequest({
      dsaId: dsa._id,
      user,
      input: {
        category: 'PAYMENT',
        service: 'flight',
        subject: 'Payment did not confirm',
        message: '<script>alert(1)</script> The payment page closed early.',
        dsaId: other._id,
      },
    });
    assert.equal(created.request.status, 'OPEN');
    assert.match(created.request.reference, /^APL-SUP-/);
    assert.equal(created.request.message.includes('script'), false);
    const mine = await listForCustomer(dsa._id, user._id);
    assert.equal(mine[0].adminNotes, undefined);
    const foreign = await listForDsa(other._id);
    assert.equal(foreign.requests.length, 0);
    const updated = await updateForDsa(dsa._id, created.request.reference, {
      status: 'IN_PROGRESS',
      adminNotes: 'Check the gateway',
      reply: 'We are looking at this payment.',
    }, 'Owner');
    assert.equal(updated.adminNotes, 'Check the gateway');
    const seen = await listForCustomer(dsa._id, user._id);
    assert.equal(seen[0].status, 'IN_PROGRESS');
    assert.equal(seen[0].replies[0].message, 'We are looking at this payment.');
    assert.equal(seen[0].adminNotes, undefined);
  });

  it('keeps a customer review pending until it is approved', async () => {
    await assert.rejects(() => createSupportRequest({
      dsaId: dsa._id,
      user,
      input: { category: 'GENERAL', service: 'general', subject: 'Need help', message: 'Please check my booking', bookingReference: 'APL-BK-NOT-MINE' },
    }));
    const review = await createCustomerReview({
      dsaId: dsa._id,
      user,
      input: { customerName: 'Imposter', rating: 4, title: 'Smooth trip', message: '<b>Great</b> support from the desk', relatedService: 'flight' },
    });
    assert.equal(review.status, 'ACTIVE');
    assert.equal(review.customerName, 'Asha Mehta');
    assert.equal(await Testimonial.countDocuments({ dsaId: dsa._id, status: 'ACTIVE', source: 'CUSTOMER' }), 1);
    await Testimonial.updateOne({ _id: review.id }, { status: 'ACTIVE' });
    assert.equal(await Testimonial.countDocuments({ dsaId: dsa._id, status: 'ACTIVE', customerId: user._id }), 1);
    await Testimonial.updateOne({ _id: review.id }, { status: 'REJECTED' });
    assert.equal(await Testimonial.countDocuments({ dsaId: dsa._id, status: 'ACTIVE', customerId: user._id }), 0);
  });
});
