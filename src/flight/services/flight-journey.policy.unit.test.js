'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectJourneyForOffer,
  assertSameSupplier,
  assertFareConfirmation,
  assertBlockUsable,
  newJourneyId,
} = require('./flight-journey.policy');

test('search journey is reused for the first selected offer', () => {
  const selected = selectJourneyForOffer(
    [{ journeyId: 'APL-JRN-SEARCH', aplFareId: null, aplFlightId: null }],
    'APL-JRN-SEARCH',
    { aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' },
    null,
  );
  assert.equal(selected.journey.journeyId, 'APL-JRN-SEARCH');
  assert.equal(selected.journey.supplier, 'TBO');
  assert.equal(selected.journeys.length, 1);
});

test('a second offer from the same search gets its own journey', () => {
  const first = selectJourneyForOffer(
    [{ journeyId: 'APL-JRN-SEARCH', aplFareId: null }],
    'APL-JRN-SEARCH',
    { aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' },
    null,
  );
  const second = selectJourneyForOffer(
    first.journeys,
    'APL-JRN-SEARCH',
    { aplFareId: 'FARE-2', aplFlightId: 'FLT-2', supplier: 'TRIPJACK' },
    null,
  );
  assert.notEqual(second.journey.journeyId, 'APL-JRN-SEARCH');
  assert.equal(second.journey.parentJourneyId, 'APL-JRN-SEARCH');
  assert.equal(second.journeys.length, 2);
});

test('the search journey id can claim the still-open journey', () => {
  const selected = selectJourneyForOffer(
    [{ journeyId: 'APL-JRN-SEARCH', aplFareId: null, aplFlightId: null }],
    'APL-JRN-SEARCH',
    { aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' },
    'APL-JRN-SEARCH',
  );
  assert.equal(selected.journey.journeyId, 'APL-JRN-SEARCH');
  assert.equal(selected.journey.aplFareId, 'FARE-1');
});

test('a search journey id for a second offer starts a separate booking journey', () => {
  const first = selectJourneyForOffer(
    [{ journeyId: 'APL-JRN-SEARCH', aplFareId: null }],
    'APL-JRN-SEARCH',
    { aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' },
    'APL-JRN-SEARCH',
  );
  const second = selectJourneyForOffer(
    first.journeys,
    'APL-JRN-SEARCH',
    { aplFareId: 'FARE-2', aplFlightId: 'FLT-2', supplier: 'TBO' },
    'APL-JRN-SEARCH',
  );
  assert.notEqual(second.journey.journeyId, 'APL-JRN-SEARCH');
  assert.equal(second.journey.parentJourneyId, 'APL-JRN-SEARCH');
});

test('a client journey id is refused when it does not match the offer', () => {
  assert.throws(
    () => selectJourneyForOffer(
      [{ journeyId: 'APL-JRN-SEARCH', aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' }],
      'APL-JRN-SEARCH',
      { aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' },
      'APL-JRN-OTHER',
    ),
    /Journey does not match/,
  );
});

test('supplier lock rejects a different supplier for the same offer', () => {
  assert.throws(
    () => selectJourneyForOffer(
      [{ journeyId: 'APL-JRN-SEARCH', aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'TBO' }],
      'APL-JRN-SEARCH',
      { aplFareId: 'FARE-1', aplFlightId: 'FLT-1', supplier: 'KAFILA' },
      null,
    ),
    /does not match the stored offer/,
  );
});

test('round trip across two suppliers is refused', () => {
  assert.throws(() => assertSameSupplier('TBO', 'TRIPJACK'), /two suppliers/);
  assert.doesNotThrow(() => assertSameSupplier('TBO', 'TBO'));
});

test('payment is refused without a current block and when the amount differs', () => {
  assert.throws(() => assertBlockUsable(null, 100), /successful flight block/);
  const expired = {
    status: 'ACCEPTED',
    amount: 100,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  assert.throws(() => assertBlockUsable(expired, 100), /expired/);
  const ok = {
    status: 'ACCEPTED',
    amount: 100,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.throws(() => assertBlockUsable(ok, 90), /does not match/);
  assert.doesNotThrow(() => assertBlockUsable(ok, 100));
});

test('journey ids are server shaped', () => {
  assert.match(newJourneyId(), /^APL-JRN-[A-F0-9]+$/);
});

test('downstream steps require a matching unexpired fare confirmation', () => {
  const confirmed = {
    fareConfirmation: {
      status: 'CONFIRMED',
      quoteId: 'QTE-1',
      supplier: 'TBO',
      aplFareId: 'FARE-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  assert.equal(assertFareConfirmation(confirmed, { aplFareId: 'FARE-1', supplier: 'TBO' }).quoteId, 'QTE-1');
  assert.throws(() => assertFareConfirmation({}, { aplFareId: 'FARE-1' }), /Confirm the selected fare/);
  assert.throws(() => assertFareConfirmation({
    fareConfirmation: { status: 'PRICE_CHANGED', quoteId: 'QTE-1', supplier: 'TBO', aplFareId: 'FARE-1' },
  }), /Accept the updated fare/);
  assert.throws(() => assertFareConfirmation({
    fareConfirmation: {
      status: 'CONFIRMED',
      quoteId: 'QTE-1',
      supplier: 'TBO',
      aplFareId: 'FARE-1',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    },
  }), /expired/);
  assert.throws(() => assertFareConfirmation(confirmed, { aplFareId: 'FARE-1', supplier: 'KAFILA' }), /supplier/);
});
