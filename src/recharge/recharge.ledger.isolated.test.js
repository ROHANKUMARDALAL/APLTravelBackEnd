'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26k';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const Dsa = require('../tenant/models/Dsa');
const User = require('../user/models/User');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const { Booking, Payment } = require('../common/database/models/Booking');
const ServiceLog = require('../common/database/models/ServiceLog');
const { validateRecharge, payRecharge, refundRecharge } = require('./services/recharge.service');
const { listBookingsForCustomer } = require('../common/services/checkout-booking.service');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26k';

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || process.env.APL_ALLOW_TEST_DB !== '1') {
    throw new Error('Refusing to run outside apl_test_phase26k');
  }
}

describe('recharge booking and wallet ledger', () => {
  let dsa;
  let user;
  let other;

  before(async () => {
    assertIsolated();
    await connectDatabase();
    if (mongoose.connection.name !== 'apl_test_phase26k') throw new Error('Wrong database');
    await mongoose.connection.db.dropDatabase();
    dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2601',
      companyName: 'Phase 26K Travel',
      displayName: 'Phase 26K Travel',
      ownerName: 'Owner',
      email: 'phase26k@example.com',
      phone: '9999999999',
      status: 'ACTIVE',
    });
    user = await User.create({
      name: 'Recharge Customer',
      email: 'recharge26k@example.com',
      phoneNumber: '9876543210',
      passwordHash: 'test-hash',
      currency: 'INR',
      balance: 2000,
    });
    other = await User.create({
      name: 'Other Customer',
      email: 'other26k@example.com',
      phoneNumber: '9876543211',
      passwordHash: 'test-hash',
      currency: 'INR',
      balance: 0,
    });
    await CustomerWallet.create({
      dsaId: dsa._id,
      userId: user._id,
      currency: 'INR',
      balance: 2000,
      totalCredits: 2000,
      totalDebits: 0,
    });
  });

  after(async () => {
    assertIsolated();
    if (mongoose.connection.name === 'apl_test_phase26k') await mongoose.connection.db.dropDatabase();
    await disconnectDatabase();
  });

  it('debits the customer wallet once and projects one booking and payment', async () => {
    const context = { requestId: 'req-26k', dsaId: dsa._id, userId: user._id };
    await validateRecharge({
      category: 'MOBILE',
      country: 'IN',
      operator: 'JIO',
      lineType: 'PREPAID',
      mobile: '9876543210',
      planId: 'JIO-299',
      circle: 'DELHI',
      amount: 299,
      idempotencyKey: 'phase26k-wallet-299',
    }, context);
    const paid = await payRecharge({
      idempotencyKey: 'phase26k-wallet-299',
      amount: 299,
      paymentMethod: 'WALLET',
      feeAmount: 0,
    }, context);
    const again = await payRecharge({
      idempotencyKey: 'phase26k-wallet-299',
      amount: 299,
      paymentMethod: 'WALLET',
      feeAmount: 0,
    }, { ...context, requestId: 'req-26k-replay' });
    assert.equal(paid.status, 'SUCCESS');
    assert.equal(paid.fulfillment, 'DEMO / MOCK RECHARGE');
    assert.equal(again.reference, paid.reference);
    assert.equal(again.paymentReference, paid.paymentReference);
    assert.match(paid.summary.transactionLabel, /Recharge Payment \(Mobile — Jio\)/);
    assert.equal(paid.dsaCode, 'APL-DSA-2601');
    const wallet = await CustomerWallet.findOne({ userId: user._id, dsaId: dsa._id }).lean();
    assert.equal(wallet.balance, 1701);
    const debits = await WalletTransaction.find({ userId: user._id, type: 'BOOKING_DEBIT' }).lean();
    assert.equal(debits.length, 1);
    assert.equal(debits[0].amount, 299);
    assert.equal(debits[0].reference, paid.paymentReference);
    assert.equal(debits[0].serviceCode, 'recharge');
    const bookings = await Booking.find({ userId: user._id, productType: 'RECHARGE' }).lean();
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].status, 'CONFIRMED');
    assert.equal(bookings[0].aplBookingRef, paid.bookingReference);
    assert.equal(bookings[0].items[0].supplierBookingStatus, 'NOT_STARTED');
    const payments = await Payment.find({ userId: user._id, method: 'WALLET' }).lean();
    assert.equal(payments.length, 1);
    assert.equal(payments[0].status, 'SUCCESS');
    assert.equal(payments[0].amount, 299);
    const listed = await listBookingsForCustomer(user, { tenant: { dsaId: dsa._id } });
    const card = listed.bookings.find((row) => row.bookingId === paid.bookingReference);
    assert.equal(card.service, 'recharge');
    assert.equal(card.recharge.operator, 'Reliance Jio');
    assert.equal(card.recharge.accountMasked.endsWith('3210'), true);
    assert.equal(card.recharge.lineType, 'Prepaid');
    const hidden = await listBookingsForCustomer(other, { tenant: { dsaId: dsa._id } });
    assert.equal(hidden.bookings.length, 0);
    const telecom = await ServiceLog.countDocuments({
      journeyId: paid.journeyId,
      operation: 'RECHARGE',
      stage: 'SUPPLIER_REQUEST',
    });
    assert.equal(telecom, 0);
  });

  it('rejects an insufficient wallet without a debit or successful booking', async () => {
    const poor = await User.create({
      name: 'Low Balance',
      email: 'low26k@example.com',
      phoneNumber: '9876543212',
      passwordHash: 'test-hash',
      currency: 'INR',
      balance: 100,
    });
    await CustomerWallet.create({
      dsaId: dsa._id,
      userId: poor._id,
      currency: 'INR',
      balance: 100,
      totalCredits: 100,
      totalDebits: 0,
    });
    const context = { requestId: 'req-26k-short', dsaId: dsa._id, userId: poor._id };
    await validateRecharge({
      category: 'MOBILE',
      country: 'IN',
      operator: 'JIO',
      lineType: 'PREPAID',
      mobile: '9876543210',
      planId: 'JIO-299',
      circle: 'DELHI',
      amount: 299,
      idempotencyKey: 'phase26k-short',
    }, context);
    await assert.rejects(
      () => payRecharge({
        idempotencyKey: 'phase26k-short',
        amount: 299,
        paymentMethod: 'WALLET',
        feeAmount: 0,
      }, context),
      /Insufficient wallet balance|available wallet balance/,
    );
    const after = await CustomerWallet.findOne({ userId: poor._id }).lean();
    assert.equal(after.balance, 100);
    assert.equal(await WalletTransaction.countDocuments({ userId: poor._id }), 0);
    assert.equal(await Booking.countDocuments({ userId: poor._id }), 0);
  });

  it('records a declined card without a wallet debit or successful fulfillment', async () => {
    const before = await CustomerWallet.findOne({ userId: user._id }).lean();
    await validateRecharge({
      category: 'MOBILE',
      country: 'IN',
      operator: 'AIRTEL',
      lineType: 'PREPAID',
      mobile: '9876543210',
      planId: 'AIRTEL-219',
      circle: 'DELHI',
      amount: 219,
      idempotencyKey: 'phase26k-decline',
    }, { requestId: 'req-26k-decline', dsaId: dsa._id, userId: user._id });
    const paid = await payRecharge({
      idempotencyKey: 'phase26k-decline',
      amount: 219,
      paymentMethod: 'CARD',
      feeAmount: quoteFee(219),
      cardLast4: '0002',
    }, { requestId: 'req-26k-decline-pay', dsaId: dsa._id, userId: user._id });
    assert.equal(paid.status, 'FAILED');
    const after = await CustomerWallet.findOne({ userId: user._id }).lean();
    assert.equal(after.balance, before.balance);
    const failed = await Payment.findOne({ userId: user._id, method: 'CARD', status: 'FAILED' }).lean();
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.providerMeta.telecomFulfilled, false);
    assert.equal(await Booking.countDocuments({ aplBookingRef: paid.bookingReference, status: 'FAILED' }), 1);
  });

  it('reverses a wallet recharge once', async () => {
    const context = { requestId: 'req-26k-refund', dsaId: dsa._id, userId: user._id };
    const before = await CustomerWallet.findOne({ userId: user._id }).lean();
    const paid = await (async () => {
      const rows = await Booking.find({ userId: user._id, status: 'CONFIRMED', productType: 'RECHARGE' }).lean();
      assert.equal(rows.length, 1);
      return rows[0];
    })();
    const orderRef = paid.serviceDetails.rechargeReference;
    const refunded = await refundRecharge(orderRef, context);
    const again = await refundRecharge(orderRef, context);
    assert.equal(refunded.status, 'REFUNDED');
    assert.equal(again.status, 'REFUNDED');
    const wallet = await CustomerWallet.findOne({ userId: user._id }).lean();
    assert.equal(wallet.balance, before.balance + 299);
    assert.equal(await WalletTransaction.countDocuments({ userId: user._id, type: 'BOOKING_REVERSAL' }), 1);
  });

  it('keeps a mock UPI recharge without touching the wallet', async () => {
    const before = await CustomerWallet.findOne({ userId: user._id }).lean();
    const context = { requestId: 'req-26k-upi', dsaId: dsa._id, userId: user._id };
    await validateRecharge({
      category: 'MOBILE',
      country: 'IN',
      operator: 'VI',
      lineType: 'PREPAID',
      mobile: '9876543210',
      planId: 'VI-179',
      circle: 'DELHI',
      amount: 179,
      idempotencyKey: 'phase26k-upi',
    }, context);
    const paid = await payRecharge({
      idempotencyKey: 'phase26k-upi',
      amount: 179,
      paymentMethod: 'UPI',
      feeAmount: 0,
    }, context);
    assert.equal(paid.status, 'SUCCESS');
    assert.equal(paid.summary.transactionLabel, 'Recharge Payment (Mobile — Vi)');
    const after = await CustomerWallet.findOne({ userId: user._id }).lean();
    assert.equal(after.balance, before.balance);
    assert.equal(await Payment.countDocuments({ paymentRef: paid.paymentReference, method: 'UPI', status: 'SUCCESS' }), 1);
  });
});

function quoteFee(amount) {
  return Math.round((Math.round(amount * 100) * 250) / 10000) / 100;
}
