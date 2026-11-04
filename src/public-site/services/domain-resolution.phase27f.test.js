'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase27f';
process.env.TRUST_PROXY = '';

const { selectInboundHost } = require('../utils/host');
const { mappingRoutable, findDsaForHost } = require('./resolve-tenant.service');
const Dsa = require('../../tenant/models/Dsa');

const DB_NAME = 'apl_test_phase27f';

function tenant(code, company, subdomain, extra = {}) {
  return {
    dsaCode: code,
    companyName: company,
    displayName: company,
    ownerName: 'Owner',
    email: `${subdomain}@example.test`,
    phone: '9999999999',
    subdomain,
    status: 'ACTIVE',
    ...extra,
  };
}

describe('domain resolution', () => {
  it('ignores a spoofed forwarded host unless a proxy is trusted', () => {
    const spoofed = selectInboundHost({
      hostHeader: 'north.localhost:3001',
      forwardedHost: 'south.localhost:3001',
      trustProxy: false,
      isProduction: true,
    });
    assert.equal(spoofed, 'north.localhost:3001');
    const trusted = selectInboundHost({
      hostHeader: 'north.localhost:3001',
      forwardedHost: 'south.localhost:3001',
      trustProxy: true,
      isProduction: true,
    });
    assert.equal(trusted, 'south.localhost:3001');
  });

  it('routes only an enabled ACTIVE custom mapping', () => {
    assert.equal(mappingRoutable({ status: 'PENDING', enabled: true }), false);
    assert.equal(mappingRoutable({ status: 'ACTIVE', enabled: false }), false);
    assert.equal(mappingRoutable({ status: 'ACTIVE', enabled: true }), true);
  });

  describe('isolated tenants', () => {
    before(async () => {
      await mongoose.connect(process.env.MONGODB_URI);
      if (mongoose.connection.name !== DB_NAME) {
        throw new Error(`Refusing to use database ${mongoose.connection.name}`);
      }
      await Dsa.syncIndexes();
      await Dsa.deleteMany({});
      await mongoose.connection.collection('bookings').deleteMany({});
      await Dsa.create([
        tenant('APL-DSA-9101', 'North Holidays', 'north'),
        tenant('APL-DSA-9102', 'South Holidays', 'south', {
          customDomains: ['south-travel.test'],
          domainMappings: [
            { host: 'south-travel.test', kind: 'CUSTOM', status: 'PENDING', enabled: true },
          ],
        }),
        tenant('APL-DSA-9103', 'East Holidays', 'east', {
          domain: 'east-travel.test',
          customDomains: ['east-travel.test'],
          domainMappings: [
            {
              host: 'east-travel.test',
              kind: 'CUSTOM',
              status: 'ACTIVE',
              enabled: true,
              primary: true,
            },
          ],
        }),
      ]);
      const north = await Dsa.findOne({ dsaCode: 'APL-DSA-9101' }).lean();
      const south = await Dsa.findOne({ dsaCode: 'APL-DSA-9102' }).lean();
      await mongoose.connection.collection('bookings').insertMany([
        { aplBookingRef: 'APL-BK-NORTH', dsaId: north._id, productType: 'FLIGHT' },
        { aplBookingRef: 'APL-BK-SOUTH', dsaId: south._id, productType: 'BUS' },
      ]);
    });

    after(async () => {
      if (mongoose.connection.name === DB_NAME) {
        await mongoose.connection.dropDatabase();
      }
      await mongoose.disconnect();
    });

    it('resolves three different hostnames to their own DSA', async () => {
      const north = await findDsaForHost('north.localhost:3001');
      const south = await findDsaForHost('south.localhost');
      const east = await findDsaForHost('www.east-travel.test');
      assert.equal(north.dsa.companyName, 'North Holidays');
      assert.equal(south.dsa.companyName, 'South Holidays');
      assert.equal(east.dsa.companyName, 'East Holidays');
    });

    it('does not route a pending or unknown hostname', async () => {
      assert.equal(await findDsaForHost('www.south-travel.test'), null);
      assert.equal(await findDsaForHost('unknown.example'), null);
    });

    it('rejects a duplicate custom hostname', async () => {
      await assert.rejects(
        () =>
          Dsa.create(
            tenant('APL-DSA-9104', 'West Holidays', 'west', {
              customDomains: ['east-travel.test'],
            }),
          ),
        /duplicate key/i,
      );
    });

    it('keeps booking rows inside the tenant that owns them', async () => {
      const north = await Dsa.findOne({ dsaCode: 'APL-DSA-9101' }).lean();
      const rows = await mongoose.connection
        .collection('bookings')
        .find({ dsaId: north._id })
        .toArray();
      assert.deepEqual(
        rows.map((row) => row.aplBookingRef),
        ['APL-BK-NORTH'],
      );
    });
  });
});
