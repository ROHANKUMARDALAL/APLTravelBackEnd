'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assignConfirmationPnr, referenceFilter, isTestPnr } = require('../src/common/services/booking-pnr');

function memoryBooking() {
  const rows = [];
  return {
    rows,
    findOne(query) {
      const found = rows.find((row) => row.pnr === query.pnr);
      const cursor = {
        select() { return cursor; },
        lean: async () => found || null,
      };
      return cursor;
    },
    async countDocuments(filter) {
      return rows.filter((row) => owns(row, filter)).length;
    },
    async find(filter) {
      const matched = rows.filter((row) => owns(row, filter));
      return {
        sort: () => ({
          skip: () => ({
            limit: (count) => matched.slice(0, count),
          }),
        }),
      };
    },
  };
}

function owns(row, filter) {
  if (filter.userId && String(row.userId) !== String(filter.userId)) return false;
  if (filter.dsaId && String(row.dsaId) !== String(filter.dsaId)) return false;
  if (filter.productType && row.productType !== filter.productType) return false;
  if (!filter.$or) return true;
  return filter.$or.some((clause) => {
    if (clause.pnr) return row.pnr === clause.pnr;
    if (clause.aplBookingRef) return row.aplBookingRef === clause.aplBookingRef;
    if (clause['items.supplierBookingRef']) {
      return (row.items || []).some((item) => item.supplierBookingRef === clause['items.supplierBookingRef']);
    }
    return false;
  });
}

test('confirmed mock services receive one unique TEST reference', async () => {
  const Booking = memoryBooking();
  const seen = new Set();
  for (const productType of ['FLIGHT', 'HOTEL', 'BUS', 'TRANSFER']) {
    const payload = { productType, status: 'CONFIRMED', supplierBookingRef: 'PNRABC123' };
    await assignConfirmationPnr(Booking, payload, { mock: true, supplierReference: 'PNRABC123' });
    assert.match(payload.pnr, /^TEST-(FLT|HTL|BUS|CAB)-[A-Z0-9]{6}$/);
    assert.equal(payload.supplierBookingRef, 'PNRABC123');
    assert.equal(isTestPnr(payload.pnr), true);
    assert.equal(seen.has(payload.pnr), false);
    seen.add(payload.pnr);
    Booking.rows.push(payload);
  }
});

test('pending failed and genuine supplier references stay unchanged', async () => {
  const Booking = memoryBooking();
  const pending = { productType: 'FLIGHT', status: 'PENDING_PAYMENT' };
  await assignConfirmationPnr(Booking, pending, { mock: true });
  assert.equal(pending.pnr, undefined);
  const genuine = { productType: 'FLIGHT', status: 'CONFIRMED', supplierBookingRef: 'LIVE12345' };
  await assignConfirmationPnr(Booking, genuine, { mock: false, supplierReference: 'live12345' });
  assert.equal(genuine.pnr, 'LIVE12345');
  assert.equal(genuine.supplierBookingRef, 'LIVE12345');
  genuine.pnr = 'LIVE12345';
  await assignConfirmationPnr(Booking, genuine, { mock: true });
  assert.equal(genuine.pnr, 'LIVE12345');
});

test('search is exact, case-insensitive, and tenant scoped', async () => {
  const Booking = memoryBooking();
  Booking.rows.push(
    { userId: 'c1', dsaId: 'd1', productType: 'FLIGHT', pnr: 'TEST-FLT-A8K29P', aplBookingRef: 'APL-BK-11111111', items: [{ supplierBookingRef: 'PNRDELBLR' }] },
    { userId: 'c2', dsaId: 'd1', productType: 'HOTEL', pnr: 'TEST-HTL-B7M42X', aplBookingRef: 'APL-BK-22222222', items: [] },
    { userId: 'c1', dsaId: 'd2', productType: 'BUS', pnr: 'TEST-BUS-C9R31D', aplBookingRef: 'APL-BK-33333333', items: [] },
  );
  const own = referenceFilter(' test-flt-a8k29p ');
  const ownRows = await Booking.countDocuments({ userId: 'c1', dsaId: 'd1', ...own });
  const otherCustomer = await Booking.countDocuments({ userId: 'c2', dsaId: 'd1', ...own });
  const otherDsa = await Booking.countDocuments({ userId: 'c1', dsaId: 'd2', ...referenceFilter('PNRDELBLR') });
  const byApl = await Booking.countDocuments({ userId: 'c1', dsaId: 'd1', ...referenceFilter('apl-bk-11111111') });
  const missing = referenceFilter('TEST-FLT-ZZZZZZ');
  const none = await Booking.countDocuments({ userId: 'c1', dsaId: 'd1', ...missing });
  const flightOnly = await Booking.countDocuments({ userId: 'c1', dsaId: 'd1', productType: 'FLIGHT', ...referenceFilter('TEST-FLT-A8K29P') });
  assert.equal(ownRows, 1);
  assert.equal(otherCustomer, 0);
  assert.equal(otherDsa, 0);
  assert.equal(byApl, 1);
  assert.equal(none, 0);
  assert.equal(flightOnly, 1);
  assert.equal(referenceFilter('ab'), null);
});
