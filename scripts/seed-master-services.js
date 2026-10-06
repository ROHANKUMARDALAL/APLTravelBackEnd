#!/usr/bin/env node
'use strict';

/**
 * Idempotent seed for master travel services.
 * Usage: node scripts/seed-master-services.js
 * Requires MONGODB_URI (same as the backend).
 */

require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../src/common/database/connection');
const { seedMasterServices } = require('../src/tenant/services/seed-master-services');

async function main() {
  await connectDatabase();
  const rows = await seedMasterServices();
  console.log('Master services seeded (idempotent):');
  for (const row of rows) {
    console.log(`- ${row.code} (${row.id}) status=${row.globalStatus}`);
  }
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
