'use strict';

/**
 * Read-only completeness report. Never updates or deletes documents.
 * Usage: node scripts/booking-completeness-dry-run.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const COLLECTIONS = ['bookings', 'bookings_flight', 'bookings_hotel', 'bookings_bus', 'bookings_transfer', 'rechargeorders'];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const report = [];
  for (const name of COLLECTIONS) {
    const collection = db.collection(name);
    const total = await collection.estimatedDocumentCount();
    const missingDsaName = name === 'rechargeorders'
      ? null
      : await collection.countDocuments({ $or: [{ dsaName: { $exists: false } }, { dsaName: '' }] });
    const missingServiceCode = name === 'rechargeorders'
      ? null
      : await collection.countDocuments({ $or: [{ serviceCode: { $exists: false } }, { serviceCode: '' }] });
    report.push({ collection: name, total, missingDsaName, missingServiceCode });
  }
  console.log(JSON.stringify({ mode: 'DRY_RUN_READ_ONLY', database: mongoose.connection.name, report }, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
