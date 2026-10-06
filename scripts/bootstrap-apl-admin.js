#!/usr/bin/env node
'use strict';

/**
 * Create the first APL Super Admin (idempotent by email).
 *
 * Required env:
 *   MONGODB_URI
 *   APL_BOOTSTRAP_ADMIN_EMAIL
 *   APL_BOOTSTRAP_ADMIN_PASSWORD
 *
 * Optional:
 *   APL_BOOTSTRAP_ADMIN_NAME (default: APL Super Admin)
 *   APL_BOOTSTRAP_ADMIN_PHONE
 *
 * Usage:
 *   APL_BOOTSTRAP_ADMIN_EMAIL=you@company.com \
 *   APL_BOOTSTRAP_ADMIN_PASSWORD='your-strong-password' \
 *   node scripts/bootstrap-apl-admin.js
 *
 * Do NOT commit real credentials. Prefer exporting env vars in your shell.
 */

require('dotenv').config();
const {
  connectDatabase,
  disconnectDatabase,
} = require('../src/common/database/connection');
const { seedAdminRoles } = require('../src/admin-auth/services/seed-roles');
const {
  createAplAdminUser,
  findAplAdminByEmail,
} = require('../src/apl-admin/services/apl-auth.service');

async function main() {
  const email = process.env.APL_BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.APL_BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.APL_BOOTSTRAP_ADMIN_NAME || 'APL Super Admin';
  const phone = process.env.APL_BOOTSTRAP_ADMIN_PHONE || '';

  if (!email || !password) {
    console.error(
      'Missing APL_BOOTSTRAP_ADMIN_EMAIL or APL_BOOTSTRAP_ADMIN_PASSWORD',
    );
    process.exit(1);
  }
  if (String(password).length < 8) {
    console.error('APL_BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  await connectDatabase();
  await seedAdminRoles();

  const existing = await findAplAdminByEmail(email);
  if (existing) {
    console.log(`APL admin already exists for ${email} (id=${existing._id}).`);
    console.log('Bootstrap is idempotent — no password change was applied.');
    await disconnectDatabase();
    return;
  }

  const user = await createAplAdminUser({
    name,
    email,
    phone,
    password,
    roleCode: 'SUPER_ADMIN',
  });

  console.log('APL Super Admin created:');
  console.log(`- id: ${user.id}`);
  console.log(`- email: ${user.email}`);
  console.log(`- role: ${user.roleCode}`);
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
