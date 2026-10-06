#!/usr/bin/env node
'use strict';

/**
 * Idempotent seed for APL + DSA system roles.
 * Usage: node scripts/seed-admin-roles.js
 */

require('dotenv').config();
const {
  connectDatabase,
  disconnectDatabase,
} = require('../src/common/database/connection');
const { seedAdminRoles } = require('../src/admin-auth/services/seed-roles');

async function main() {
  await connectDatabase();
  const rows = await seedAdminRoles();
  console.log('Admin roles seeded (idempotent):');
  for (const row of rows) {
    console.log(
      `- ${row.scope}/${row.code} (${row.id}) permissions=${row.permissionCount}`,
    );
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
