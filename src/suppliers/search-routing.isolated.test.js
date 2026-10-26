'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase20_flow';
process.env.PUBLIC_DEV_HOST_MAP = 'phase20.localhost=APL-DSA-2020,other20.localhost=APL-DSA-2021';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const DsaService = require('../tenant/models/DsaService');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const DsaSupplier = require('../common/database/models/DsaSupplier');
const ServiceLog = require('../common/database/models/ServiceLog');

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== 'mongodb://127.0.0.1:27018/apl_test_phase20_flow') {
    throw new Error('Refusing to run outside apl_test_phase20_flow');
  }
}

async function assign(dsaId, service, codes, strategy) {
  for (const [index, code] of codes.entries()) {
    const supplier = await Supplier.findOneAndUpdate(
      { code },
      {
        $set: {
          name: `${code} Mock`,
          status: 'ACTIVE',
          isMock: true,
          environments: ['TEST'],
          defaultEnvironment: 'TEST',
        },
      },
      { upsert: true, new: true },
    );
    await SupplierService.findOneAndUpdate(
      { supplierId: supplier._id, serviceId: service._id },
      { $set: { enabled: true, environment: 'TEST' } },
      { upsert: true },
    );
    await DsaSupplier.create({
      dsaId,
      serviceId: service._id,
      supplierId: supplier._id,
      enabled: true,
      priority: index + 1,
      routingStrategy: strategy,
    });
  }
}

function post(server, path, body, host) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-apl-public-host': host,
    },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, payload: await res.json() }));
}

describe('phase 20 search routing regression', () => {
  let server;

  before(async () => {
    assertIsolated();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2020',
      companyName: 'Phase 20 Flow',
      displayName: 'Phase 20 Flow',
      ownerName: 'Owner',
      email: 'flow20@example.test',
      phone: '9990002020',
      subdomain: 'phase20',
      status: 'ACTIVE',
    });
    await Dsa.create({
      dsaCode: 'APL-DSA-2021',
      companyName: 'Other 20',
      displayName: 'Other 20',
      ownerName: 'Other',
      email: 'other20@example.test',
      phone: '9990002021',
      subdomain: 'other20',
      status: 'ACTIVE',
    });
    const hotel = await Service.findOne({ code: 'hotel' });
    const bus = await Service.findOne({ code: 'bus' });
    const transfer = await Service.findOne({ code: 'transfer' });
    for (const service of [hotel, bus, transfer]) {
      await DsaService.create({
        dsaId: dsa._id,
        serviceId: service._id,
        isAllowedByAPL: true,
        isActiveByDSA: true,
      });
    }
    await assign(dsa._id, hotel, ['TBO', 'TRIPJACK', 'KAFILA'], 'PARALLEL');
    await assign(dsa._id, bus, ['MOCKBUS_A', 'MOCKBUS_B'], 'PARALLEL');
    await assign(dsa._id, transfer, ['MOCKXFER_A', 'MOCKXFER_B'], 'FALLBACK');
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('searches hotel, bus, and transfer only through assigned suppliers', async () => {
    const hotel = await post(server, '/api/v1/hotels/search', {
      city: 'New Delhi',
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      rooms: 1,
      adults: 2,
      children: 0,
      currency: 'INR',
    }, 'phase20.localhost');
    assert.equal(hotel.status, 200, JSON.stringify(hotel.payload));
    assert.ok(hotel.payload.data.hotels.length > 0);

    const bus = await post(server, '/api/v1/buses/search', {
      origin: 'New York',
      destination: 'Boston',
      travelDate: '2026-12-01',
    }, 'phase20.localhost');
    assert.equal(bus.status, 200, JSON.stringify(bus.payload));
    assert.ok(bus.payload.data.buses.length > 0);
    const busSuppliers = await ServiceLog.distinct('supplierCode', {
      searchId: bus.payload.data.searchId,
      stage: 'SUPPLIER_REQUEST',
    });
    assert.deepEqual(busSuppliers.sort(), ['MOCKBUS_A', 'MOCKBUS_B']);

    const transfer = await post(server, '/api/v1/transfers/search', {
      pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
      dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
      pickupDateTime: '2026-12-01T14:30',
      passengers: 2,
    }, 'phase20.localhost');
    assert.equal(transfer.status, 200, JSON.stringify(transfer.payload));
    const transferSuppliers = await ServiceLog.distinct('supplierCode', {
      searchId: transfer.payload.data.searchId,
      stage: 'SUPPLIER_REQUEST',
    });
    assert.deepEqual(transferSuppliers, ['MOCKXFER_A']);

    const foreign = await post(server, '/api/v1/hotels/search', {
      city: 'New Delhi',
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      rooms: 1,
      adults: 2,
      children: 0,
      currency: 'INR',
    }, 'other20.localhost');
    assert.equal(foreign.status, 403);
  });
});
