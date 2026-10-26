'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase20';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const DsaSupplier = require('../common/database/models/DsaSupplier');
const { buildSupplierExecutionPlan } = require('./services/supplier-routing.service');

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== 'mongodb://127.0.0.1:27018/apl_test_phase20') {
    throw new Error('Refusing to run outside apl_test_phase20');
  }
}

describe('phase 20 supplier assignment', () => {
  let dsaId;
  let flightId;

  before(async () => {
    assertIsolated();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    const flight = await Service.findOne({ code: 'flight' });
    flightId = flight._id;
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2001',
      companyName: 'Phase 20',
      displayName: 'Phase 20',
      ownerName: 'Owner',
      email: 'phase20@example.test',
      phone: '9990002001',
      subdomain: 'phase20',
      status: 'ACTIVE',
    });
    dsaId = dsa._id;
    for (const [index, code] of ['TBO', 'TRIPJACK', 'KAFILA'].entries()) {
      const supplier = await Supplier.create({
        code,
        name: `${code} Mock`,
        status: 'ACTIVE',
        isMock: true,
        environments: ['TEST'],
        defaultEnvironment: 'TEST',
      });
      await SupplierService.create({
        supplierId: supplier._id,
        serviceId: flightId,
        enabled: code !== 'KAFILA',
        environment: 'TEST',
      });
      await DsaSupplier.create({
        dsaId,
        serviceId: flightId,
        supplierId: supplier._id,
        enabled: code !== 'TRIPJACK',
        priority: index + 1,
        routingStrategy: 'PRIORITY',
      });
    }
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('excludes a disabled assignment and a disabled supplier-service mapping', async () => {
    const plan = await buildSupplierExecutionPlan({ dsaId, serviceCode: 'flight' });
    assert.equal(plan.strategy, 'PRIORITY');
    assert.deepEqual(plan.suppliers.map((row) => row.supplierCode), ['TBO']);
    assert.equal(plan.suppliers[0].isMock, true);
  });

  it('rejects a DSA with no eligible supplier instead of substituting mocks', async () => {
    await DsaSupplier.updateMany({ dsaId }, { $set: { enabled: false } });
    await assert.rejects(
      () => buildSupplierExecutionPlan({ dsaId, serviceCode: 'flight' }),
      (error) => error.code === 'NO_SUPPLIER_ASSIGNED',
    );
  });
});
