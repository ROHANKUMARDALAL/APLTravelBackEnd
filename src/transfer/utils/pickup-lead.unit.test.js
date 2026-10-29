'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { minimumPickup, isPickupAllowed, assertPickupLeadTime } = require('./pickup-lead');
const { validateTransferSearchBody } = require('../validators/transfer.validation');

describe('cab pickup lead time', () => {
  const zone = 'Asia/Kolkata';

  it('accepts exactly two hours and rejects anything earlier', () => {
    const now = new Date('2026-10-27T04:30:00.000Z');
    assert.deepEqual(minimumPickup(now, zone), { date: '2026-10-27', time: '12:00', timeZone: zone });
    assert.equal(isPickupAllowed('2026-10-27T12:00', now, zone), true);
    assert.equal(isPickupAllowed('2026-10-27T11:59', now, zone), false);
    assert.throws(() => assertPickupLeadTime('2026-10-27T11:59', zone, now), /at least 2 hours/);
  });

  it('rolls the earliest pickup into the next day', () => {
    const now = new Date('2026-10-27T17:30:00.000Z');
    assert.deepEqual(minimumPickup(now, zone), { date: '2026-10-28', time: '01:00', timeZone: zone });
    assert.equal(isPickupAllowed('2026-10-27T23:30', now, zone), false);
    assert.equal(isPickupAllowed('2026-10-28T01:00', now, zone), true);
  });

  it('rejects a direct search inside the lead window', () => {
    assert.throws(
      () => validateTransferSearchBody({
        pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT' },
        dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
        pickupDateTime: '2020-01-01T10:00',
        timeZone: zone,
      }),
      /at least 2 hours/,
    );
  });

  it('follows daylight-saving jumps by elapsed time', () => {
    const now = new Date('2026-03-08T06:30:00.000Z');
    assert.equal(minimumPickup(now, 'America/New_York').time, '04:30');
    assert.equal(minimumPickup(now, 'America/New_York').date, '2026-03-08');
  });
});
