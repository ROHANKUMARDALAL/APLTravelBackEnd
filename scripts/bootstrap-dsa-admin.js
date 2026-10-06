#!/usr/bin/env node
'use strict';

/**
 * Controlled DSAAdmin bootstrap for local/dev testing (not public signup).
 *
 * Required env:
 *   MONGODB_URI
 *   DSA_BOOTSTRAP_DSA_ID          (existing Dsa _id)
 *   OR DSA_BOOTSTRAP_CREATE_DSA=1 (creates a temporary DSA if none provided)
 *   DSA_BOOTSTRAP_ADMIN_EMAIL
 *   DSA_BOOTSTRAP_ADMIN_PASSWORD
 *
 * Optional:
 *   DSA_BOOTSTRAP_ADMIN_NAME
 *   DSA_BOOTSTRAP_ADMIN_PHONE
 *   DSA_BOOTSTRAP_ROLE (default DSA_OWNER)
 */

require('dotenv').config();
const {
  connectDatabase,
  disconnectDatabase,
} = require('../src/common/database/connection');
const { seedAdminRoles } = require('../src/admin-auth/services/seed-roles');
const { createDsa } = require('../src/tenant/services/dsa.service');
const { createDsaAdminUser } = require('../src/dsa-admin/services/dsa-auth.service');
const DsaAdminUser = require('../src/dsa-admin/models/DsaAdminUser');
const Dsa = require('../src/tenant/models/Dsa');

async function main() {
  const email = process.env.DSA_BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.DSA_BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.DSA_BOOTSTRAP_ADMIN_NAME || 'DSA Owner';
  const phone = process.env.DSA_BOOTSTRAP_ADMIN_PHONE || '';
  const roleCode = process.env.DSA_BOOTSTRAP_ROLE || 'DSA_OWNER';
  let dsaId = process.env.DSA_BOOTSTRAP_DSA_ID;

  if (!email || !password) {
    console.error(
      'Missing DSA_BOOTSTRAP_ADMIN_EMAIL or DSA_BOOTSTRAP_ADMIN_PASSWORD',
    );
    process.exit(1);
  }
  if (String(password).length < 8) {
    console.error('DSA_BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  await connectDatabase();
  await seedAdminRoles();

  if (!dsaId && process.env.DSA_BOOTSTRAP_CREATE_DSA === '1') {
    const dsa = await createDsa({
      companyName: 'Dev DSA Tenant',
      displayName: 'Dev DSA',
      ownerName: name,
      email: `tenant+${Date.now()}@example.com`,
      phone: phone || '+910000000000',
      status: 'ACTIVE',
    });
    dsaId = String(dsa._id);
    console.log(`Created DSA tenant ${dsa.dsaCode} (${dsaId})`);
  }

  if (!dsaId) {
    console.error(
      'Provide DSA_BOOTSTRAP_DSA_ID or set DSA_BOOTSTRAP_CREATE_DSA=1',
    );
    process.exit(1);
  }

  const dsa = await Dsa.findById(dsaId);
  if (!dsa) {
    console.error(`DSA not found: ${dsaId}`);
    process.exit(1);
  }

  const existing = await DsaAdminUser.findOne({
    dsaId: dsa._id,
    email: String(email).trim().toLowerCase(),
  });
  if (existing) {
    console.log(
      `DSA admin already exists for ${email} under ${dsa.dsaCode} (id=${existing._id}).`,
    );
    await disconnectDatabase();
    return;
  }

  const user = await createDsaAdminUser({
    dsaId: dsa._id,
    name,
    email,
    phone,
    password,
    roleCode,
  });

  console.log('DSAAdmin user created:');
  console.log(`- id: ${user.id}`);
  console.log(`- email: ${user.email}`);
  console.log(`- dsa: ${user.dsaCode} (${user.dsaId})`);
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
