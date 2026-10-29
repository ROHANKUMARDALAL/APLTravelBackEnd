'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase24n';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const {
  debitCustomerWalletForBooking,
  reverseCustomerWalletDebit,
} = require('./customer-wallet-payment');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase24n';

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || !URI.includes('apl_test_phase24n')) {
    throw new Error('Refusing to run outside apl_test_phase24n');
  }
}

async function wallet(balance) {
  const userId = new mongoose.Types.ObjectId();
  const dsaId = new mongoose.Types.ObjectId();
  await CustomerWallet.create({ userId, dsaId, currency: 'INR', balance, totalCredits: balance, totalDebits: 0 });
  return { userId, dsaId };
}

describe('Phase 24N customer wallet booking payment', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    if (mongoose.connection.name === 'apl_test_phase24n') await mongoose.connection.dropDatabase();
  });

  after(async () => {
    assertIsolated();
    if (mongoose.connection.name === 'apl_test_phase24n') await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('rejects 2000 against 3773 and accepts equal or higher balances', async () => {
    const low = await wallet(2000);
    await assert.rejects(
      () => debitCustomerWalletForBooking({ ...low, currency: 'INR', amount: 3773, paymentRef: 'PAY-LOW' }),
      (error) => {
        assert.equal(error.code, 'INSUFFICIENT_WALLET_BALANCE');
        assert.equal(error.details[0].shortfall, 1773);
        return true;
      },
    );
    assert.equal((await CustomerWallet.findOne(low)).balance, 2000);

    const exact = await wallet(3773);
    const paid = await debitCustomerWalletForBooking({ ...exact, currency: 'INR', amount: 3773, paymentRef: 'PAY-EXACT' });
    assert.equal(paid.balance, 0);

    const high = await wallet(5000);
    const covered = await debitCustomerWalletForBooking({ ...high, currency: 'INR', amount: 3773, paymentRef: 'PAY-HIGH' });
    assert.equal(covered.balance, 1227);
  });

  it('debits a repeated payment once, blocks concurrent overspend, and reverses a failed booking', async () => {
    const once = await wallet(3773);
    await debitCustomerWalletForBooking({ ...once, currency: 'INR', amount: 3773, paymentRef: 'PAY-ONCE' });
    const replay = await debitCustomerWalletForBooking({ ...once, currency: 'INR', amount: 3773, paymentRef: 'PAY-ONCE' });
    assert.equal(replay.replay, true);
    assert.equal((await CustomerWallet.findOne(once)).balance, 0);
    assert.equal(await WalletTransaction.countDocuments({ paymentRef: 'PAY-ONCE', type: 'BOOKING_DEBIT' }), 1);

    const shared = await wallet(3000);
    const results = await Promise.allSettled([
      debitCustomerWalletForBooking({ ...shared, currency: 'INR', amount: 2000, paymentRef: 'PAY-A' }),
      debitCustomerWalletForBooking({ ...shared, currency: 'INR', amount: 2000, paymentRef: 'PAY-B' }),
    ]);
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(results.filter((row) => row.status === 'rejected').length, 1);
    assert.equal((await CustomerWallet.findOne(shared)).balance, 1000);

    const failed = await wallet(5000);
    await debitCustomerWalletForBooking({ ...failed, currency: 'INR', amount: 3773, paymentRef: 'PAY-FAIL' });
    await reverseCustomerWalletDebit({ ...failed, currency: 'INR', amount: 3773, paymentRef: 'PAY-FAIL' });
    await reverseCustomerWalletDebit({ ...failed, currency: 'INR', amount: 3773, paymentRef: 'PAY-FAIL' });
    assert.equal((await CustomerWallet.findOne(failed)).balance, 5000);
    assert.equal(await WalletTransaction.countDocuments({ paymentRef: 'PAY-FAIL', type: 'BOOKING_REVERSAL' }), 1);
  });
});
