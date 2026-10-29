'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase24o';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { Booking, Payment } = require('../common/database/models/Booking');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const { debitCustomerWalletForBooking } = require('./customer-wallet-payment');
const { bookingPaymentLabel, serviceCodesForWalletRows } = require('./booking-payment-label');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase24o';

describe('Phase 24O wallet service labels', () => {
  before(async () => {
    if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing shared database');
    await connectDatabase();
    if (mongoose.connection.name === 'apl_test_phase24o') await mongoose.connection.dropDatabase();
  });

  after(async () => {
    if (mongoose.connection.name === 'apl_test_phase24o') await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('reads service codes from linked bookings and leaves unknown history unlabeled', async () => {
    const userId = new mongoose.Types.ObjectId();
    const dsaId = new mongoose.Types.ObjectId();
    const services = ['FLIGHT', 'HOTEL', 'BUS', 'TRANSFER', 'INSURANCE'];
    const rows = [];
    for (const productType of services) {
      const booking = await Booking.create({
        aplBookingRef: `APL-BK-${productType}`,
        productType,
        currency: 'INR',
        totalAmount: 1000,
        userId,
        dsaId,
      });
      const paymentRef = `PAY-${productType}`;
      await Payment.create({
        paymentRef,
        bookingId: booking._id,
        userId,
        dsaId,
        amount: 1000,
        currency: 'INR',
        status: 'SUCCESS',
        method: 'WALLET',
      });
      rows.push(await WalletTransaction.create({
        dsaId,
        userId,
        amount: 1000,
        direction: 'DEBIT',
        type: 'BOOKING_DEBIT',
        currency: 'INR',
        reference: paymentRef,
        paymentRef,
        reason: 'Booking payment',
        balanceAfter: 0,
        method: 'WALLET',
      }));
    }
    const unknown = await WalletTransaction.create({
      dsaId,
      userId,
      amount: 50,
      direction: 'DEBIT',
      type: 'BOOKING_DEBIT',
      currency: 'INR',
      reference: 'PAY-OLD',
      paymentRef: 'PAY-OLD',
      reason: 'Booking payment',
      balanceAfter: 0,
    });
    const codes = await serviceCodesForWalletRows(userId, [...rows, unknown]);
    assert.equal(bookingPaymentLabel(codes.get(String(rows[0]._id))), 'Booking Payment (Flight)');
    assert.equal(bookingPaymentLabel(codes.get(String(rows[1]._id))), 'Booking Payment (Hotel)');
    assert.equal(bookingPaymentLabel(codes.get(String(rows[2]._id))), 'Booking Payment (Bus)');
    assert.equal(bookingPaymentLabel(codes.get(String(rows[3]._id))), 'Booking Payment (Cab)');
    assert.equal(bookingPaymentLabel(codes.get(String(rows[4]._id))), 'Booking Payment (Insurance)');
    assert.equal(bookingPaymentLabel(codes.get(String(unknown._id))), 'Booking Payment');
    assert.equal(await WalletTransaction.countDocuments({ userId, type: 'BOOKING_DEBIT' }), 6);
  });

  it('stores the checkout service code without an extra debit', async () => {
    const userId = new mongoose.Types.ObjectId();
    const dsaId = new mongoose.Types.ObjectId();
    await CustomerWallet.create({ userId, dsaId, currency: 'INR', balance: 5000, totalCredits: 5000, totalDebits: 0 });
    await debitCustomerWalletForBooking({
      userId,
      dsaId,
      currency: 'INR',
      amount: 3773,
      paymentRef: 'PAY-STORED-FLIGHT',
      bookingReference: 'APL-BK-NEW',
      serviceCode: 'FLIGHT',
    });
    const replay = await debitCustomerWalletForBooking({
      userId,
      dsaId,
      currency: 'INR',
      amount: 3773,
      paymentRef: 'PAY-STORED-FLIGHT',
      serviceCode: 'FLIGHT',
    });
    assert.equal(replay.replay, true);
    assert.equal((await CustomerWallet.findOne({ userId, dsaId })).balance, 1227);
    const stored = await WalletTransaction.findOne({ paymentRef: 'PAY-STORED-FLIGHT', type: 'BOOKING_DEBIT' }).lean();
    assert.equal(stored.serviceCode, 'flight');
    assert.equal(await WalletTransaction.countDocuments({ paymentRef: 'PAY-STORED-FLIGHT', type: 'BOOKING_DEBIT' }), 1);
  });
});
