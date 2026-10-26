'use strict';

const Service = require('../models/Service');

/**
 * Canonical master catalogue. Upsert by code so existing service ids stay put.
 * globalStatus of an existing row is never overwritten.
 * Alias codes (cab, holidays, insiurance) are not created and are not renamed.
 */
const MASTER_SERVICES = [
  {
    code: 'flight',
    name: 'Flight',
    slug: 'flight',
    description: 'Domestic and international flights',
    icon: 'plane',
    globalStatus: 'ACTIVE',
    displayOrder: 10,
    serviceMode: 'API_BOOKING',
  },
  {
    code: 'hotel',
    name: 'Hotel',
    slug: 'hotel',
    description: 'Hotel stays and accommodation',
    icon: 'hotel',
    globalStatus: 'ACTIVE',
    displayOrder: 20,
    serviceMode: 'API_BOOKING',
  },
  {
    code: 'bus',
    name: 'Bus',
    slug: 'bus',
    description: 'Intercity bus travel',
    icon: 'bus',
    globalStatus: 'ACTIVE',
    displayOrder: 30,
    serviceMode: 'API_BOOKING',
  },
  {
    code: 'transfer',
    name: 'Transfer (Cab)',
    slug: 'transfer',
    description: 'Airport and city transfers',
    icon: 'transfer',
    globalStatus: 'ACTIVE',
    displayOrder: 40,
    serviceMode: 'API_BOOKING',
  },
  {
    code: 'visa',
    name: 'Visa',
    slug: 'visa',
    description: 'Visa assistance by enquiry',
    icon: 'visa',
    globalStatus: 'ACTIVE',
    displayOrder: 50,
    serviceMode: 'ENQUIRY',
  },
  {
    code: 'recharge',
    name: 'Recharge',
    slug: 'recharge',
    description: 'Recharge requests',
    icon: 'recharge',
    globalStatus: 'ACTIVE',
    displayOrder: 60,
    serviceMode: 'CONFIGURABLE',
  },
  {
    code: 'holiday',
    name: 'Holidays',
    slug: 'holiday',
    description: 'Holiday packages by enquiry. Enabling this service does not open a live supplier booking API.',
    icon: 'holiday',
    globalStatus: 'ACTIVE',
    displayOrder: 70,
    serviceMode: 'ENQUIRY',
  },
  {
    code: 'insurance',
    name: 'Insurance',
    slug: 'insurance',
    description: 'Travel insurance by enquiry',
    icon: 'insurance',
    globalStatus: 'ACTIVE',
    displayOrder: 80,
    serviceMode: 'ENQUIRY',
  },
];

/**
 * Idempotent upsert of master services by stable `code`.
 * Safe to run multiple times; does not create duplicates or change global status.
 */
async function seedMasterServices() {
  const results = [];
  for (const row of MASTER_SERVICES) {
    const set = {
      slug: row.slug,
      description: row.description,
      icon: row.icon,
      displayOrder: row.displayOrder,
      serviceMode: row.serviceMode,
    };
    const setOnInsert = {
      code: row.code,
      globalStatus: row.globalStatus,
    };
    if (row.code === 'transfer' || row.code === 'holiday') set.name = row.name;
    else setOnInsert.name = row.name;
    const doc = await Service.findOneAndUpdate(
      { code: row.code },
      {
        $set: set,
        $setOnInsert: setOnInsert,
      },
      { upsert: true, new: true, runValidators: true },
    );
    results.push({
      code: doc.code,
      id: String(doc._id),
      globalStatus: doc.globalStatus,
      serviceMode: doc.serviceMode,
    });
  }
  return results;
}

module.exports = { seedMasterServices, MASTER_SERVICES };
