'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase25d';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('./connection');
const { Booking, Payment } = require('./models/Booking');
const Refund = require('../../payments/models/Refund');
const RechargeOrder = require('../../recharge/models/RechargeOrder');

const URI = process.env.APL_TEST_MONGODB_URI;

function sample(productType, ref, dsaId, when) {
  return {
    aplBookingRef: ref,
    productType,
    status: 'CONFIRMED',
    currency: 'INR',
    totalAmount: 100,
    dsaId,
    userId: new mongoose.Types.ObjectId(),
    requestId: `req-${ref}`,
    journeyId: `journey-${ref}`,
    searchId: `search-${ref}`,
    guestEmail: 'guest@example.test',
    bookedAtUtc: when,
    createdAt: when,
    items: [{
      productType,
      supplierCode: 'TBO',
      supplierBookingRef: `SUP-${ref}`,
      supplierBookingStatus: 'CONFIRMED',
      amount: 100,
      currency: 'INR',
    }],
    travellers: [{ type: 'ADULT', firstName: 'Ava', lastName: 'Shah' }],
  };
}

describe('service booking collections', () => {
  let dsaA;
  let dsaB;

  before(async () => {
    if (!URI.endsWith('/apl_test_phase25d')) throw new Error('refusing shared database');
    await connectDatabase();
    if (mongoose.connection.name !== 'apl_test_phase25d') throw new Error('connected to the wrong database');
    await mongoose.connection.dropDatabase();
    const idA = new mongoose.Types.ObjectId();
    const idB = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('dsas').insertMany([
      { _id: idA, dsaCode: 'APL-DSA-2501', displayName: 'Harbor Desk', companyName: 'Harbor' },
      { _id: idB, dsaCode: 'APL-DSA-2502', displayName: 'Other Desk', companyName: 'Other' },
    ]);
    dsaA = { _id: idA };
    dsaB = { _id: idB };
  });

  after(async () => {
    if (mongoose.connection.name === 'apl_test_phase25d') await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('stores new service bookings once and still reads historical rows', async () => {
    const created = {};
    for (const [product, ref] of [
      ['FLIGHT', 'APL-BK-25D-FLIGHT'],
      ['HOTEL', 'APL-BK-25D-HOTEL'],
      ['BUS', 'APL-BK-25D-BUS'],
      ['TRANSFER', 'APL-BK-25D-CAB'],
    ]) {
      const stamp = {
        FLIGHT: '2026-10-27T10:01:00Z',
        HOTEL: '2026-10-27T10:02:00Z',
        BUS: '2026-10-27T10:03:00Z',
        TRANSFER: '2026-10-27T10:04:00Z',
      }[product];
      created[product] = await Booking.create(sample(product, ref, dsaA._id, new Date(stamp)));
      assert.equal(created[product].dsaCode, 'APL-DSA-2501');
      assert.equal(created[product].dsaName, 'Harbor Desk');
    }
    await mongoose.connection.collection('bookings').insertOne(sample('FLIGHT', 'APL-BK-25D-OLD', dsaA._id, new Date('2020-01-01T00:00:00Z')));
    await Booking.create(sample('FLIGHT', 'APL-BK-25D-OTHER', dsaB._id, new Date('2026-10-27T11:00:00Z')));

    async function only(collection, ref) {
      const names = ['bookings', 'bookings_flight', 'bookings_hotel', 'bookings_bus', 'bookings_transfer'];
      const counts = await Promise.all(names.map((name) => mongoose.connection.collection(name).countDocuments({ aplBookingRef: ref })));
      const found = names.filter((_, index) => counts[index] === 1);
      assert.deepEqual(found, [collection]);
    }
    await only('bookings', 'APL-BK-25D-FLIGHT');
    await only('bookings', 'APL-BK-25D-HOTEL');
    await only('bookings', 'APL-BK-25D-BUS');
    await only('bookings', 'APL-BK-25D-CAB');
    await only('bookings', 'APL-BK-25D-OLD');

    const listed = await Booking.find({ dsaId: dsaA._id }).sort({ createdAt: -1 }).lean();
    assert.deepEqual(listed.map((row) => row.aplBookingRef), [
      'APL-BK-25D-CAB',
      'APL-BK-25D-BUS',
      'APL-BK-25D-HOTEL',
      'APL-BK-25D-FLIGHT',
      'APL-BK-25D-OLD',
    ]);
    assert.equal(await Booking.countDocuments({ dsaId: dsaA._id }), 5);
    assert.equal(await Booking.countDocuments({ dsaId: dsaB._id }), 1);
    const found = await Booking.findOne({ aplBookingRef: 'APL-BK-25D-OLD', dsaId: dsaA._id }).lean();
    assert.equal(found.productType, 'FLIGHT');
    const page = await Booking.find({}).sort({ createdAt: -1 }).skip(1).limit(2).select('aplBookingRef').lean();
    assert.deepEqual(page.map((row) => row.aplBookingRef), ['APL-BK-25D-CAB', 'APL-BK-25D-BUS']);

    await assert.rejects(() => Booking.create(sample('FLIGHT', 'APL-BK-25D-FLIGHT', dsaA._id, new Date())), (error) => error.code === 11000);
    assert.equal(await mongoose.connection.collection('bookings').countDocuments({ aplBookingRef: 'APL-BK-25D-FLIGHT' }), 1);

    const payment = await Payment.create({
      paymentRef: 'PAY-25D-1',
      bookingId: created.FLIGHT._id,
      dsaId: dsaA._id,
      amount: 100,
      currency: 'INR',
      status: 'SUCCESS',
    });
    const refund = await Refund.create({
      refundRef: 'RF-25D-1',
      paymentId: payment._id,
      bookingId: created.FLIGHT._id,
      aplBookingRef: 'APL-BK-25D-FLIGHT',
      dsaId: dsaA._id,
      requestedAmount: 100,
      approvedAmount: 100,
      currency: 'INR',
    });
    const booking = await Booking.findById(payment.bookingId);
    booking.status = 'CANCELLED';
    await booking.save();
    const cancelled = await Booking.findOne({ aplBookingRef: refund.aplBookingRef }).lean();
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(String(cancelled._id), String(refund.bookingId));
    assert.equal(await Payment.countDocuments({ bookingId: created.FLIGHT._id }), 1);
    assert.equal(await mongoose.connection.collection('bookings').countDocuments({ aplBookingRef: 'APL-BK-25D-FLIGHT' }), 1);

    const grouped = await Booking.aggregate([
      { $match: { dsaId: dsaA._id } },
      { $group: { _id: '$productType', count: { $sum: 1 } } },
    ]);
    const flightCount = grouped.find((row) => row._id === 'FLIGHT').count;
    assert.equal(flightCount, 2);
    await mongoose.connection.collection('bookings_flight').insertOne({
      ...sample('FLIGHT', 'APL-BK-25D-FLIGHT', dsaA._id, new Date('2026-10-27T10:01:00Z')),
      userId: created.FLIGHT.userId,
      totalAmount: 9999,
    });
    const deduped = await Booking.aggregate([
      { $match: { dsaId: dsaA._id, productType: 'FLIGHT' } },
      { $group: { _id: '$productType', count: { $sum: 1 }, sales: { $sum: '$totalAmount' } } },
    ]);
    assert.equal(deduped[0].count, 2);
    assert.equal(deduped[0].sales, 200);
    const canonical = await Booking.findOne({ aplBookingRef: 'APL-BK-25D-FLIGHT' }).lean();
    assert.equal(canonical.totalAmount, 100);
    assert.equal(canonical.serviceCode, 'FLIGHT');
    assert.equal(canonical.supplierCode, 'TBO');
    const customers = await Booking.distinct('userId', { dsaId: dsaA._id, userId: { $ne: null } });
    assert.equal(customers.length, 5);
    const otherCustomers = await Booking.distinct('userId', { dsaId: dsaB._id });
    assert.equal(otherCustomers.length, 1);
    assert.notEqual(String(otherCustomers[0]), String(customers[0]));
    assert.equal(RechargeOrder.collection.collectionName, 'rechargeorders');
    assert.equal(await mongoose.connection.collection('bookings_recharge').countDocuments({}), 0);
  });
});
