'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCandidate } = require('./utils/bus-normalization');
const { resolveBuses, matchKey } = require('./utils/bus-entity-resolution');
const {
  consolidateBusOffers,
  sanitizeBusSearchForPublic,
} = require('./utils/offer-consolidation');
const {
  validateBusSearchBody,
} = require('./validators/bus.validation');
const {
  formatAplLocationId,
  normalizeLocationInput,
} = require('./services/location.service');
const { AppError } = require('../common/errors/app-error');

describe('Phase 14A bus location + validation', () => {
  it('builds APL-owned location ids (not supplier ids)', () => {
    const loc = normalizeLocationInput('New York');
    assert.equal(loc.aplLocationId, 'APL-LOC-NEW-YORK');
    assert.equal(formatAplLocationId('Delhi'), 'APL-LOC-DELHI');
  });

  it('validates APL bus search contract', () => {
    const dto = validateBusSearchBody({
      from: 'New York',
      to: 'Boston',
      travelDate: '2099-06-15',
    });
    assert.equal(dto.originCity, 'New York');
    assert.equal(dto.destinationCity, 'Boston');
    assert.equal(dto.origin.aplLocationId, 'APL-LOC-NEW-YORK');
  });

  it('rejects same origin/destination', () => {
    assert.throws(
      () =>
        validateBusSearchBody({
          origin: 'Delhi',
          destination: 'Delhi',
          travelDate: '2099-06-15',
        }),
      (err) => err instanceof AppError,
    );
  });
});

describe('Phase 14A bus normalization + safe consolidation', () => {
  const base = {
    supplierServiceId: 'MBA-1',
    operator: 'East Coast Express',
    busType: 'Express coach',
    departureTime: '07:30',
    arrivalTime: '12:05',
    durationMinutes: 275,
    fromStation: 'Port Authority',
    toStation: 'South Station',
    originCity: 'New York',
    destinationCity: 'Boston',
    travelDate: '2099-06-15',
    seatsLeft: 12,
    fareAmount: 3200,
    currency: 'INR',
    amenities: ['Wi-Fi'],
    boardingPoints: [{ code: 'PA-42', name: 'Gate 42' }],
    droppingPoints: [{ code: 'SS-B', name: 'Bay B' }],
  };

  it('normalizes supplier fields without promoting supplier id as aplBusId', () => {
    const n = normalizeCandidate(base, 'MOCKBUS_A');
    assert.equal(n.supplier, 'MOCKBUS_A');
    assert.equal(n.supplierServiceId, 'MBA-1');
    assert.equal(n.departure.aplLocationId, 'APL-LOC-NEW-YORK');
    assert.equal(n.supplierPrice.amount, 3200);
    assert.equal(n.aplBusId, undefined);
  });

  it('merges only when operator+route+times+date match', () => {
    const a = normalizeCandidate(base, 'MOCKBUS_A');
    const b = normalizeCandidate(
      { ...base, supplierServiceId: 'MBB-1', fareAmount: 3100, seatsLeft: 10 },
      'MOCKBUS_B',
    );
    const different = normalizeCandidate(
      { ...base, operator: 'Other Coach', supplierServiceId: 'X-1' },
      'MOCKBUS_B',
    );
    const clusters = resolveBuses([a, b, different]);
    assert.equal(clusters.length, 2);
    const overlap = clusters.find((c) => c.members.length === 2);
    assert.ok(overlap);
    assert.equal(overlap.members.map((m) => m.supplier).sort().join(','), 'MOCKBUS_A,MOCKBUS_B');
    assert.match(overlap.aplBusId, /^APL-BUS-/);
  });

  it('does not over-merge when times differ', () => {
    const a = normalizeCandidate(base, 'MOCKBUS_A');
    const b = normalizeCandidate(
      { ...base, departureTime: '09:15', arrivalTime: '14:40', supplierServiceId: 'MBB-2' },
      'MOCKBUS_B',
    );
    assert.notEqual(matchKey(a), matchKey(b));
    assert.equal(resolveBuses([a, b]).length, 2);
  });

  it('prices offers and strips commercialSnapshot for public B2C', () => {
    const a = normalizeCandidate(base, 'MOCKBUS_A');
    const b = normalizeCandidate(
      { ...base, supplierServiceId: 'MBB-1', fareAmount: 3100 },
      'MOCKBUS_B',
    );
    const clusters = resolveBuses([a, b]);
    const buses = consolidateBusOffers(clusters, {
      rules: [],
      serviceCode: 'bus',
      dsaId: null,
      at: new Date(),
      pricingVersion: '12.0',
    });
    assert.equal(buses.length, 1);
    assert.equal(buses[0].offers.length, 2);
    assert.ok(buses[0].offers[0].commercialSnapshot);
    assert.ok(buses[0].offers[0].supplierPrice);

    const pub = sanitizeBusSearchForPublic({ buses });
    assert.equal(pub.buses[0].offers[0].commercialSnapshot, undefined);
    assert.equal(pub.buses[0].offers[0].supplierPrice, undefined);
    assert.match(pub.buses[0].aplBusId, /^APL-BUS-/);
    assert.ok(!String(pub.buses[0].aplBusId).includes('MBA'));
  });
});
