#!/usr/bin/env node
/**
 * Copy local Mongo collections into the live (Render/Atlas) database.
 *
 * Usage:
 *   MONGODB_URI_LIVE="mongodb+srv://..." node scripts/sync-local-mongo-to-live.js
 *
 * Optional:
 *   MONGODB_URI_LOCAL="mongodb://127.0.0.1:27017/apl_travel"
 *
 * Get MONGODB_URI_LIVE from Render → apltravelbackend → Environment → MONGODB_URI
 */
'use strict';

const { MongoClient } = require('mongodb');

const LOCAL_URI =
  process.env.MONGODB_URI_LOCAL || 'mongodb://127.0.0.1:27017/apl_travel';
const LIVE_URI = process.env.MONGODB_URI_LIVE || process.env.MONGODB_URI || '';

const COLLECTIONS = [
  'users',
  'savedtravellers',
  'bookings',
  'payments',
  'accountactions',
  'loginsessions',
  'checkoutsessions',
];

async function syncCollection(localDb, liveDb, name) {
  const local = localDb.collection(name);
  const live = liveDb.collection(name);
  const docs = await local.find({}).toArray();
  if (!docs.length) {
    console.log(`skip ${name}: empty locally`);
    return { name, upserted: 0, modified: 0 };
  }

  let upserted = 0;
  let modified = 0;
  for (const doc of docs) {
    const filter = doc._id != null ? { _id: doc._id } : doc;
    const result = await live.updateOne(filter, { $set: doc }, { upsert: true });
    if (result.upsertedCount) upserted += 1;
    else if (result.modifiedCount) modified += 1;
  }
  console.log(`${name}: upserted=${upserted} modified=${modified} totalLocal=${docs.length}`);
  return { name, upserted, modified };
}

async function main() {
  if (!LIVE_URI || /127\.0\.0\.1|localhost/.test(LIVE_URI)) {
    console.error(
      'Set MONGODB_URI_LIVE to your Render/Atlas connection string (not localhost).',
    );
    process.exit(1);
  }

  const localClient = new MongoClient(LOCAL_URI);
  const liveClient = new MongoClient(LIVE_URI);
  await localClient.connect();
  await liveClient.connect();
  const localDb = localClient.db();
  const liveDb = liveClient.db();

  console.log('Local DB:', localDb.databaseName);
  console.log('Live DB:', liveDb.databaseName);

  for (const name of COLLECTIONS) {
    const exists = await localDb.listCollections({ name }).hasNext();
    if (!exists) {
      console.log(`skip ${name}: missing locally`);
      continue;
    }
    await syncCollection(localDb, liveDb, name);
  }

  await localClient.close();
  await liveClient.close();
  console.log('Done. Restart is not required — Atlas data is shared immediately.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
