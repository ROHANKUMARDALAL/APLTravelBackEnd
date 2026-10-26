'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase17h_serve';
process.env.MONGODB_URI = process.env.APL_TEST_MONGODB_URI;
process.env.PORT = process.env.PORT || '3010';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const fs = require('fs');
const { connectDatabase } = require('../src/common/database/connection');
const { createApp } = require('../src/app');
const { seedMasterServices } = require('../src/tenant/services/seed-master-services');
const Dsa = require('../src/tenant/models/Dsa');
const Service = require('../src/tenant/models/Service');
const DsaService = require('../src/tenant/models/DsaService');
const { mongoose } = require('../src/common/database/connection');

async function main() {
  if (!String(process.env.APL_TEST_MONGODB_URI).includes('127.0.0.1:27018/apl_test_phase17h_serve')) {
    throw new Error('Refusing to start outside the isolated database');
  }
  await connectDatabase();
  await mongoose.connection.dropDatabase();
  await seedMasterServices();
  const flight = await Service.findOne({ code: 'flight' });
  await Dsa.create({
    dsaCode: 'APL-DSA-1701',
    companyName: 'Phase 17H Holidays',
    displayName: 'Phase 17H Holidays',
    ownerName: 'Phase Owner',
    email: 'owner-17h@example.test',
    phone: '9990001701',
    subdomain: 'phase17h',
    status: 'ACTIVE',
  }).then(async (dsa) => {
    await DsaService.create({
      dsaId: dsa._id,
      serviceId: flight._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
  });
  const app = createApp();
  await new Promise((resolve) => app.listen(Number(process.env.PORT), '127.0.0.1', resolve));
  fs.mkdirSync('/tmp/apl-phase17h', { recursive: true });
  fs.writeFileSync('/tmp/apl-phase17h/ready', String(process.env.PORT));
  console.log('phase17h-api-ready');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
