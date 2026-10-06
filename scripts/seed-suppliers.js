#!/usr/bin/env node
'use strict';

/**
 * Idempotent seed of development mock suppliers + Flight/Hotel/Bus/Transfer mappings.
 * Usage: node scripts/seed-suppliers.js
 *
 * Optional: set SEED_DSA_CODE=APL-DSA-00xx to assign mock Bus/Transfer suppliers
 * to that DSA for local B2C verification.
 */

require('dotenv').config();
const {
  connectDatabase,
  disconnectDatabase,
} = require('../src/common/database/connection');
const { seedMasterServices } = require('../src/tenant/services/seed-master-services');
const Supplier = require('../src/common/database/models/Supplier');
const SupplierService = require('../src/common/database/models/SupplierService');
const Service = require('../src/tenant/models/Service');
const Dsa = require('../src/tenant/models/Dsa');
const DsaSupplier = require('../src/common/database/models/DsaSupplier');
const {
  upsertDsaServiceMapping,
} = require('../src/tenant/services/dsa-service-mapping.service');

const MOCK_SUPPLIERS = [
  {
    code: 'TBO',
    name: 'TBO (Mock)',
    description: 'Development mock TBO adapter',
    services: ['flight', 'hotel'],
  },
  {
    code: 'TRIPJACK',
    name: 'TripJack (Mock)',
    description: 'Development mock TripJack adapter',
    services: ['flight', 'hotel'],
  },
  {
    code: 'KAFILA',
    name: 'Kafila (Mock)',
    description: 'Development mock Kafila adapter',
    services: ['flight', 'hotel'],
  },
  {
    code: 'MOCKBUS_A',
    name: 'Mock Bus Network A',
    description: 'Phase 14A deterministic mock bus supplier A',
    services: ['bus'],
  },
  {
    code: 'MOCKBUS_B',
    name: 'Mock Bus Network B',
    description: 'Phase 14A deterministic mock bus supplier B',
    services: ['bus'],
  },
  {
    code: 'MOCKXFER_A',
    name: 'Mock Transfer Network A',
    description: 'Phase 14B deterministic mock transfer supplier A',
    services: ['transfer'],
  },
  {
    code: 'MOCKXFER_B',
    name: 'Mock Transfer Network B',
    description: 'Phase 14B deterministic mock transfer supplier B',
    services: ['transfer'],
  },
];

async function main() {
  await connectDatabase();
  await seedMasterServices();

  for (const def of MOCK_SUPPLIERS) {
    const supplier = await Supplier.findOneAndUpdate(
      { code: def.code },
      {
        $set: {
          name: def.name,
          description: def.description,
          status: 'ACTIVE',
          isMock: true,
          environments: ['TEST'],
          defaultEnvironment: 'TEST',
          credentialRef: `SUPPLIER_${def.code}`,
          credentialsConfigured: false,
        },
        $setOnInsert: { code: def.code },
      },
      { upsert: true, new: true },
    );

    for (const serviceCode of def.services) {
      const service = await Service.findOne({ code: serviceCode });
      if (!service) continue;
      await SupplierService.findOneAndUpdate(
        { supplierId: supplier._id, serviceId: service._id },
        { $set: { enabled: true, environment: null } },
        { upsert: true, new: true },
      );
    }
    console.log(`Supplier ${def.code} ready (${supplier._id})`);
  }

  const dsaCode = String(process.env.SEED_DSA_CODE || '').trim();
  if (dsaCode) {
    const dsa = await Dsa.findOne({ dsaCode });
    if (!dsa) {
      console.warn(`SEED_DSA_CODE=${dsaCode} not found — skip DSA assignments`);
    } else {
      const assignService = async (serviceCode, supplierCodes, note) => {
        const service = await Service.findOne({ code: serviceCode });
        if (!service) return;
        if (serviceCode === 'transfer') {
          service.globalStatus = 'ACTIVE';
          await service.save();
        }
        await upsertDsaServiceMapping({
          dsaId: dsa._id,
          serviceId: service._id,
          isAllowedByAPL: true,
          isActiveByDSA: true,
        });
        let priority = 1;
        for (const code of supplierCodes) {
          const supplier = await Supplier.findOne({ code });
          if (!supplier) continue;
          await DsaSupplier.findOneAndUpdate(
            {
              dsaId: dsa._id,
              serviceId: service._id,
              supplierId: supplier._id,
            },
            {
              $set: {
                enabled: true,
                priority: priority++,
                routingStrategy: 'PARALLEL',
                notes: note,
              },
            },
            { upsert: true, new: true },
          );
          console.log(`Assigned ${code} → ${dsaCode} (${serviceCode.toUpperCase()})`);
        }
      };

      await assignService('bus', ['MOCKBUS_A', 'MOCKBUS_B'], 'Phase 14A seed');
      await assignService(
        'transfer',
        ['MOCKXFER_A', 'MOCKXFER_B'],
        'Phase 14B seed',
      );
    }
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
