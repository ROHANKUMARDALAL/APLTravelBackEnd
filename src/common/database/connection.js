'use strict';

const mongoose = require('mongoose');
const { config } = require('../config');
const { bookingClock, serviceFolderName } = require('../utils/booking-time');
const {
  isDatabaseTestProcess,
  assertIsolatedTestDatabase,
  assertDestructiveCleanup,
  currentApprovedDatabaseName,
} = require('./test-database-guard');

function armDestructiveGuards() {
  const collectionPrototype = mongoose.Collection.prototype;
  if (!collectionPrototype.__aplTestGuarded) {
    collectionPrototype.__aplTestGuarded = true;
    const originalDeleteMany = collectionPrototype.deleteMany;
    collectionPrototype.deleteMany = function deleteManyGuarded(filter, options, callback) {
      if (isDatabaseTestProcess()) {
        const databaseName = this.conn?.name || this.conn?.db?.databaseName || '';
        try {
          assertDestructiveCleanup({
            collection: this.collectionName || this.name,
            filter,
            databaseName,
          });
        } catch (error) {
          if (typeof options === 'function') return options(error);
          if (typeof callback === 'function') return callback(error);
          return Promise.reject(error);
        }
      }
      return originalDeleteMany.call(this, filter, options, callback);
    };
  }

  const db = mongoose.connection.db;
  if (db && !db.__aplTestGuarded) {
    db.__aplTestGuarded = true;
    const originalDrop = db.dropDatabase.bind(db);
    db.dropDatabase = async function dropDatabaseGuarded(...args) {
      assertDestructiveCleanup({
        operation: 'dropDatabase',
        databaseName: db.databaseName,
        filter: { isolatedRun: currentApprovedDatabaseName() },
      });
      return originalDrop(...args);
    };
    const originalCollection = db.collection.bind(db);
    db.collection = function collectionGuarded(name, options) {
      const coll = originalCollection(name, options);
      if (!coll.__aplTestGuarded) {
        coll.__aplTestGuarded = true;
        const originalDelete = coll.deleteMany.bind(coll);
        coll.deleteMany = function nativeDeleteManyGuarded(filter, options) {
          assertDestructiveCleanup({
            collection: name,
            filter,
            databaseName: db.databaseName,
          });
          return originalDelete(filter, options);
        };
      }
      return coll;
    };
  }
}

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
  const uri = isDatabaseTestProcess() ? assertIsolatedTestDatabase() : config.mongodbUri;
  await mongoose.connect(uri);
  if (isDatabaseTestProcess()) armDestructiveGuards();
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
