'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26i';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const ServiceLog = require('../common/database/models/ServiceLog');
const { validateRecharge, payRecharge } = require('./services/recharge.service');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26i';
const DSA = new mongoose.Types.ObjectId();
const USER = new mongoose.Types.ObjectId();

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || process.env.APL_ALLOW_TEST_DB !== '1') {
    throw new Error('Refusing to run outside apl_test_phase26i');
  }
}

describe('demo plan payment stays local', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    if (mongoose.connection.name !== 'apl_test_phase26i') throw new Error('Wrong database');
    await mongoose.connection.db.dropDatabase();
  });

  after(async () => {
    assertIsolated();
    if (mongoose.connection.name === 'apl_test_phase26i') await mongoose.connection.db.dropDatabase();
    await disconnectDatabase();
  });

  it('locks the catalogue amount, pays once, and does not invent a telecom supplier call', async () => {
    const context = { requestId: 'req-26i', dsaId: DSA, userId: USER };
    const locked = await validateRecharge({
      category: 'MOBILE',
      country: 'IN',
      operator: 'JIO',
      lineType: 'PREPAID',
      mobile: '9876543210',
      planId: 'JIO-199',
      circle: 'DELHI',
      amount: 199,
      idempotencyKey: 'phase26i-jio-199',
    }, context);
    assert.equal(locked.amount, 199);
    assert.equal(locked.summary.plan.id, 'JIO-199');
    assert.equal(locked.summary.plan.validity, '28 days');
    assert.equal(locked.test, true);
    const paid = await payRecharge({ idempotencyKey: 'phase26i-jio-199', amount: 199, paymentMethod: 'UPI' }, context);
    const again = await payRecharge({ idempotencyKey: 'phase26i-jio-199', amount: 199, paymentMethod: 'UPI' }, { ...context, requestId: 'req-26i-2' });
    assert.equal(paid.status, 'SUCCESS');
    assert.equal(again.reference, paid.reference);
    const telecom = await ServiceLog.countDocuments({ journeyId: paid.journeyId, operation: 'RECHARGE', stage: 'SUPPLIER_REQUEST' });
    const payments = await ServiceLog.countDocuments({ journeyId: paid.journeyId, operation: 'PAYMENT', stage: 'SUPPLIER_REQUEST' });
    assert.equal(telecom, 0);
    assert.equal(payments, 1);
  });

  it('rejects a client amount that does not match the plan', async () => {
    await assert.rejects(
      () => validateRecharge({
        category: 'MOBILE',
        country: 'IN',
        operator: 'JIO',
        lineType: 'PREPAID',
        mobile: '9876543210',
        planId: 'JIO-199',
        circle: 'DELHI',
        amount: 1,
        idempotencyKey: 'phase26i-mismatch',
      }, { requestId: 'req-26i-bad', dsaId: DSA, userId: USER }),
      /amount does not match/,
    );
  });
});
