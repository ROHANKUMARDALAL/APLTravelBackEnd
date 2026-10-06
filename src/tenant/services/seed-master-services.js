'use strict';

const Service = require('../models/Service');

/** Initial master catalogue. Codes stay compatible with B2C SERVICE ids. */
const MASTER_SERVICES = [
  {
    code: 'flight',
    name: 'Flight',
    slug: 'flight',
    description: 'Domestic and international flights',
    icon: 'plane',
    globalStatus: 'ACTIVE',
    displayOrder: 10,
  },
  {
    code: 'hotel',
    name: 'Hotel',
    slug: 'hotel',
    description: 'Hotel stays and accommodation',
    icon: 'hotel',
    globalStatus: 'ACTIVE',
    displayOrder: 20,
  },
  {
    code: 'bus',
    name: 'Bus',
    slug: 'bus',
    description: 'Intercity bus travel',
    icon: 'bus',
    globalStatus: 'ACTIVE',
    displayOrder: 30,
  },
  {
    code: 'transfer',
    name: 'Transfer',
    slug: 'transfer',
    description: 'Airport and city transfers',
    icon: 'transfer',
    globalStatus: 'ACTIVE',
    displayOrder: 40,
  },
];

/**
 * Idempotent upsert of master services by stable `code`.
 * Safe to run multiple times; does not create duplicates.
 */
async function seedMasterServices() {
  const results = [];
  for (const row of MASTER_SERVICES) {
    const doc = await Service.findOneAndUpdate(
      { code: row.code },
      {
        $set: {
          name: row.name,
          slug: row.slug,
          description: row.description,
          icon: row.icon,
          // Preserve an admin-changed globalStatus if the service already exists.
          // Only set defaults for brand-new rows via $setOnInsert for status.
          displayOrder: row.displayOrder,
        },
        $setOnInsert: {
          code: row.code,
          globalStatus: row.globalStatus,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    results.push({
      code: doc.code,
      id: String(doc._id),
      globalStatus: doc.globalStatus,
    });
  }
  return results;
}

module.exports = { seedMasterServices, MASTER_SERVICES };
