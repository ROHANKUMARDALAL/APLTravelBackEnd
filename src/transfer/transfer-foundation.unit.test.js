'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCandidate } = require('./utils/transfer-normalization');
const {
  resolveTransfers,
  matchKey,
} = require('./utils/transfer-entity-resolution');
const {
  consolidateTransferOffers,
  sanitizeTransferSearchForPublic,
} = require('./utils/offer-consolidation');
const {
  validateTransferSearchBody,
} = require('./validators/transfer.validation');
const {
  formatAplLocationId,
  normalizeTransferPoint,
} = require('./services/location.service');
const { AppError } = require('../common/errors/app-error');

describe('Phase 14B transfer location + validation', () => {
  it('builds APL-owned airport/city location ids', () => {
    const apt = normalizeTransferPoint('Delhi Airport (DEL)', 'AIRPORT');
    assert.match(apt.aplLocationId, /^APL-APT-/);
    assert.equal(apt.kind, 'AIRPORT');
    assert.equal(formatAplLocationId('Connaught Place', 'CITY'), 'APL-LOC-CONNAUGHT-PLACE');
  });

  it('validates APL transfer search contract', () => {
    const dto = validateTransferSearchBody({
      pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
      dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
      pickupDate: '2099-09-01',
      pickupTime: '14:30',
      passengers: 2,
    });
    assert.equal(dto.pickupDateTime, '2099-09-01T14:30');
    assert.equal(dto.transferType, 'AIRPORT_TRANSFER');
    assert.equal(dto.passengers, 2);
  });

  it('rejects same pickup/dropoff', () => {
    assert.throws(
      () =>
        validateTransferSearchBody({
          pickup: { name: 'Same Place', kind: 'CITY' },
          dropoff: { name: 'Same Place', kind: 'CITY' },
          pickupDateTime: '2099-09-01T10:00',
        }),
      (err) => err instanceof AppError,
    );
  });
});

describe('Phase 14B transfer normalization + consolidation', () => {
  const base = {
    supplierServiceId: 'MXA-1',
    vehicleCategory: 'SEDAN',
    vehicleName: 'Comfort Sedan',
    maxPassengers: 3,
    maxLuggage: 2,
    estimatedDurationMinutes: 45,
    inclusions: ['Meet & greet'],
    transferType: 'AIRPORT_TRANSFER',
    fareAmount: 1800,
    currency: 'INR',
    pickup: {
      name: 'Delhi Airport (DEL)',
      kind: 'AIRPORT',
      aplLocationId: 'APL-APT-DELHI-AIRPORT-DEL',
    },
    dropoff: {
      name: 'The Leela Palace Delhi',
      kind: 'HOTEL',
      aplLocationId: 'APL-LOC-THE-LEELA-PALACE-DELHI',
    },
    pickupDateTime: '2099-09-01T14:30',
  };

  it('does not promote supplier id as aplTransferId', () => {
    const n = normalizeCandidate(base, 'MOCKXFER_A');
    assert.equal(n.supplier, 'MOCKXFER_A');
    assert.equal(n.aplTransferId, undefined);
    assert.equal(n.supplierPrice.amount, 1800);
  });

  it('merges only when route + vehicle category + capacity match', () => {
    const a = normalizeCandidate(base, 'MOCKXFER_A');
    const b = normalizeCandidate(
      { ...base, supplierServiceId: 'MXB-1', fareAmount: 1750 },
      'MOCKXFER_B',
    );
    const van = normalizeCandidate(
      {
        ...base,
        supplierServiceId: 'MXB-VAN',
        vehicleCategory: 'VAN',
        vehicleName: 'Group Van',
        maxPassengers: 8,
        fareAmount: 3200,
      },
      'MOCKXFER_B',
    );
    const clusters = resolveTransfers([a, b, van]);
    assert.equal(clusters.length, 2);
    const sedan = clusters.find((c) => c.members.length === 2);
    assert.ok(sedan);
    assert.match(sedan.aplTransferId, /^APL-XFER-/);
  });

  it('does not over-merge different categories', () => {
    const a = normalizeCandidate(base, 'MOCKXFER_A');
    const b = normalizeCandidate(
      { ...base, vehicleCategory: 'SUV', maxPassengers: 5, supplierServiceId: 'X' },
      'MOCKXFER_B',
    );
    assert.notEqual(matchKey(a), matchKey(b));
  });

  it('strips commercialSnapshot for public B2C', () => {
    const a = normalizeCandidate(base, 'MOCKXFER_A');
    const b = normalizeCandidate(
      { ...base, supplierServiceId: 'MXB-1', fareAmount: 1750 },
      'MOCKXFER_B',
    );
    const transfers = consolidateTransferOffers(resolveTransfers([a, b]), {
      rules: [],
      serviceCode: 'transfer',
      dsaId: null,
      at: new Date(),
      pricingVersion: '12.0',
    });
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].offers.length, 2);
    const pub = sanitizeTransferSearchForPublic({ transfers });
    assert.equal(pub.transfers[0].offers[0].commercialSnapshot, undefined);
    assert.equal(pub.transfers[0].offers[0].supplierPrice, undefined);
  });
});
