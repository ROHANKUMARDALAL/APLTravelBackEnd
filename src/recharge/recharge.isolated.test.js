'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase19';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const ServiceLog = require('../common/database/models/ServiceLog');
const {
  catalogue,
  plansFor,
  billFor,
  validateRecharge,
  payRecharge,
} = require('./services/recharge.service');

const DSA = new mongoose.Types.ObjectId();
const USER = new mongoose.Types.ObjectId();

function assertIsolated() {
  const uri = String(process.env.APL_TEST_MONGODB_URI || '');
  if (uri !== 'mongodb://127.0.0.1:27018/apl_test_phase19' || process.env.APL_ALLOW_TEST_DB !== '1') {
    throw new Error('Refusing to run outside apl_test_phase19');
  }
}

describe('recharge mock lifecycle', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    await mongoose.connection.db.dropDatabase();
  });

  after(async () => {
    assertIsolated();
    await mongoose.connection.db.dropDatabase();
    await disconnectDatabase();
  });

  it('lists countries and India operators without inventing foreign Indian brands', () => {
    const meta = catalogue();
    assert.ok(meta.countries.length > 200);
    assert.deepEqual(meta.mobileOperators.IN.map((row) => row.name), ['Jio', 'Airtel', 'Vi', 'BSNL']);
    assert.equal(meta.mobileOperators.FR, undefined);
    assert.ok(meta.electricity.some((row) => row.name === 'Paschimanchal Vidyut Vitran Nigam Limited'));
    assert.ok(meta.metros.some((row) => row.name === 'Delhi Metro'));
  });

  it('returns prepaid plans and a labelled postpaid test bill', () => {
    const plans = plansFor('IN', 'JIO', 'PREPAID');
    assert.equal(plans.plans[0].id, 'JIO-239');
    assert.equal(plans.test, true);
    const bill = billFor({ category: 'MOBILE', country: 'IN', operator: 'AIRTEL', lineType: 'POSTPAID', mobile: '9876543210' });
    assert.match(bill.notice, /MOCK \/ TEST/);
    assert.ok(bill.amount > 0);
  });

  it('fetches electricity, broadband, gas, and metro quotes', async () => {
    const electricity = billFor({ category: 'ELECTRICITY', state: 'Maharashtra', provider: 'MSEDCL', account: 'MH123456' });
    const broadband = billFor({ category: 'BROADBAND', provider: 'JIOFIBER', account: '9000001111' });
    const gas = billFor({ category: 'GAS', provider: 'IGL', account: 'BP123456' });
    assert.match(electricity.notice, /TEST/);
    assert.equal(broadband.provider, 'JioFiber');
    assert.equal(gas.details.category, 'Piped natural gas');
    const context = { requestId: 'req-metro', dsaId: DSA, userId: USER };
    const locked = await validateRecharge({
      category: 'METRO',
      provider: 'DMRC',
      account: '123456789012',
      amount: 200,
      idempotencyKey: 'metro-key-001',
    }, context);
    assert.equal(locked.amount, 200);
    assert.equal(locked.status, 'VALIDATED');
    assert.match(locked.notice, /metro system was contacted/i);
  });

  it('rejects a second payment with the same key after success', async () => {
    const context = { requestId: 'req-jio', dsaId: DSA, userId: USER };
    const locked = await validateRecharge({
      category: 'MOBILE',
      country: 'IN',
      operator: 'JIO',
      lineType: 'PREPAID',
      mobile: '9876543210',
      planId: 'JIO-239',
      idempotencyKey: 'jio-key-001',
    }, context);
    const paid = await payRecharge({ idempotencyKey: 'jio-key-001', amount: locked.amount, cardLast4: '4242' }, context);
    const again = await payRecharge({ idempotencyKey: 'jio-key-001', amount: locked.amount, cardLast4: '4242' }, { ...context, requestId: 'req-jio-2' });
    assert.equal(paid.status, 'SUCCESS');
    assert.equal(again.reference, paid.reference);
    const payments = await ServiceLog.countDocuments({ journeyId: paid.journeyId, businessOperation: 'PAYMENT', stage: 'SUPPLIER_REQUEST' });
    assert.equal(payments, 1);
  });
});
