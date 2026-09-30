'use strict';

const mongoose = require('mongoose');
const { config } = require('../config');
const { bookingClock, serviceFolderName } = require('../utils/booking-time');

async function ensureBookingServiceView() {
  const db = mongoose.connection.db;
  const existing = await db.listCollections({ name: 'bookingServices' }).toArray();
  if (existing[0] && existing[0].type !== 'view') return;
  if (existing.length) {
    await db.dropCollection('bookingServices');
  }
  await db.createCollection('bookingServices', {
    viewOn: 'bookings',
    pipeline: [
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $toLower: '$productType' },
          service: { $first: { $toLower: '$productType' } },
          bookings: { $push: '$$ROOT' },
        },
      },
      { $project: { _id: 0, service: 1, bookings: 1 } },
      { $sort: { service: 1 } },
    ],
  });
}

async function backfillBookingFolders() {
  const Booking = mongoose.connection.collection('bookings');
  const docs = await Booking.find({
    $or: [{ services: { $exists: false } }, { bookedAtLocal: { $exists: false } }],
  }).toArray();

  for (const doc of docs) {
    const clock = bookingClock(doc.createdAt || new Date(), doc.currency);
    const serviceName = serviceFolderName(doc.productType);
    const serviceRecord = {
      aplBookingRef: doc.aplBookingRef,
      status: doc.status,
      currency: doc.currency,
      totalAmount: doc.totalAmount,
      bookedAtUtc: clock.bookedAtUtc,
      bookedAtLocal: clock.bookedAtLocal,
      timeZone: clock.timeZone,
      guestEmail: doc.guestEmail,
      guestPhone: doc.guestPhone,
      travellers: doc.travellers || [],
      items: doc.items || [],
    };
    await Booking.updateOne(
      { _id: doc._id },
      {
        $set: {
          bookedAtUtc: clock.bookedAtUtc,
          timeZone: clock.timeZone,
          bookedAtLocal: clock.bookedAtLocal,
          [`services.${serviceName}`]: serviceRecord,
        },
      },
    );
  }
}

async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri);
  await backfillBookingFolders();
  await ensureBookingServiceView();
  console.log('Connected to MongoDB');
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

async function isDatabaseHealthy() {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    await mongoose.connection.db.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isDatabaseHealthy,
  mongoose,
};
