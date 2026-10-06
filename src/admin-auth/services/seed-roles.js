'use strict';

const AdminRole = require('../models/AdminRole');
const {
  APL_ROLE_DEFINITIONS,
  DSA_ROLE_DEFINITIONS,
} = require('../permissions');

/**
 * Idempotent seed of system roles for APL + DSA scopes.
 */
async function seedAdminRoles() {
  const definitions = [...APL_ROLE_DEFINITIONS, ...DSA_ROLE_DEFINITIONS];
  const results = [];

  for (const def of definitions) {
    const doc = await AdminRole.findOneAndUpdate(
      { scope: def.scope, code: def.code },
      {
        $set: {
          name: def.name,
          permissions: def.permissions,
          status: 'ACTIVE',
          isSystem: true,
        },
        $setOnInsert: {
          scope: def.scope,
          code: def.code,
        },
      },
      { upsert: true, new: true },
    );
    results.push({
      scope: doc.scope,
      code: doc.code,
      id: String(doc._id),
      permissionCount: doc.permissions.length,
    });
  }

  return results;
}

module.exports = { seedAdminRoles };
