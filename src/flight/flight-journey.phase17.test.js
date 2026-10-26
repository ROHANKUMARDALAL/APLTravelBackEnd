'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateFlightSearchBody } = require('./validators/flight.validation');
const { searchCityAirports } = require('./services/airport-search.service');
const { getMockTboFlights } = require('./data/mock-tbo-flights');
const { mockTboFlightAdapter } = require('./suppliers/tbo/mock-tbo.adapter');
const { sumSelected, assertExactPrice } = require('../common/utils/price-confirm');
const { flightAddOnCatalog } = require('./data/addons');
const { calculatePrice } = require('../pricing/services/pricing-engine.service');
const { AppError } = require('../common/errors/app-error');

const future = '2026-11-20';

function errorText(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AppError);
    return `${err.message} ${(err.details || []).join(' ')}`;
  }
  assert.fail('expected a validation error');
}

function searchBody(overrides = {}) {
  return {
    journeyType: 'ONE_WAY',
    origin: 'DEL',
    destination: 'BLR',
    departureDate: future,
    returnDate: null,
    passengers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    ...overrides,
  };
}

describe('phase 17 airport and search validation', () => {
  it('finds Delhi by code, city, and airport name', () => {
    const byCode = searchCityAirports({ query: 'DEL' });
    assert.ok(byCode.airports.some((row) => row.iata === 'DEL'));
    assert.match(byCode.airports.find((row) => row.iata === 'DEL').label, /Indira Gandhi/);
    const byCity = searchCityAirports({ query: 'delhi' });
    assert.ok(byCity.cities.some((row) => row.cityCode === 'DEL'));
    const byName = searchCityAirports({ query: 'heathrow' });
    assert.ok(byName.airports.some((row) => row.iata === 'LHR'));
  });

  it('accepts the normalized one-way search contract', () => {
    const dto = validateFlightSearchBody(searchBody());
    assert.equal(dto.tripType, 'ONEWAY');
    assert.equal(dto.originCityCode, 'DEL');
    assert.equal(dto.destinationCityCode, 'BLR');
    assert.equal(dto.departDate, future);
    assert.equal(dto.adults, 1);
  });

  it('requires a return date on round trip and rejects an earlier return', () => {
    assert.match(
      errorText(() =>
        validateFlightSearchBody(searchBody({ journeyType: 'ROUND_TRIP', returnDate: null })),
      ),
      /returnDate is required/,
    );
    const dto = validateFlightSearchBody(
      searchBody({ journeyType: 'ROUND_TRIP', returnDate: '2026-11-25' }),
    );
    assert.equal(dto.tripType, 'ROUNDTRIP');
    assert.match(
      errorText(() =>
        validateFlightSearchBody(
          searchBody({ journeyType: 'ROUND_TRIP', returnDate: '2026-11-01' }),
        ),
      ),
      /before departDate/,
    );
  });

  it('rejects the same city, a past date, too many infants, and an unknown airport', () => {
    assert.match(errorText(() => validateFlightSearchBody(searchBody({ destination: 'DEL' }))), /different/);
    assert.match(
      errorText(() => validateFlightSearchBody(searchBody({ departureDate: '2020-01-01' }))),
      /past/,
    );
    assert.match(
      errorText(() =>
        validateFlightSearchBody(
          searchBody({ passengers: { adults: 1, children: 0, infants: 2 } }),
        ),
      ),
      /infants/,
    );
    assert.match(errorText(() => validateFlightSearchBody(searchBody({ origin: 'ZZZ' }))), /Unknown/);
  });
});

describe('phase 17 mock inventory', () => {
  it('returns nonstop and connecting Delhi to Bengaluru flights with stable fares', () => {
    const flights = getMockTboFlights({
      origin: 'DEL',
      destination: 'BLR',
      departDate: future,
      currency: 'INR',
    });
    assert.ok(flights.length >= 3);
    const connecting = flights.find((row) => row.stops === 1);
    assert.ok(connecting);
    assert.equal(connecting.segments.length, 2);
    assert.equal(connecting.segments[0].destination, 'HYD');
    const again = getMockTboFlights({
      origin: 'DEL',
      destination: 'BLR',
      departDate: future,
      currency: 'INR',
    });
    assert.deepEqual(
      flights.map((row) => row.supplierPrice.amount),
      again.map((row) => row.supplierPrice.amount),
    );
    const refundable = flights.find((row) => row.refundable);
    const restricted = flights.find((row) => !row.refundable);
    assert.ok(refundable && restricted);
  });

  it('returns a Bengaluru to Delhi flight for the return selection', () => {
    const inbound = getMockTboFlights({
      origin: 'BLR',
      destination: 'DEL',
      departDate: '2026-11-25',
      currency: 'INR',
    });
    assert.ok(inbound.length >= 1);
    assert.equal(inbound[0].segments[0].origin, 'BLR');
  });
});

describe('phase 17 fare quote, SSR, and price checks', () => {
  const offer = getMockTboFlights({
    origin: 'DEL',
    destination: 'BLR',
    departDate: future,
    currency: 'INR',
  })[0];

  it('quotes the stored supplier fare', async () => {
    const quote = await mockTboFlightAdapter.fareQuote(offer);
    assert.equal(quote.status, 'AVAILABLE');
    assert.equal(quote.priceChanged, false);
    assert.equal(quote.price.amount, offer.supplierPrice.amount);
    assert.ok(quote.quoteId);
    assert.ok(quote.fareRules.cancellation);
  });

  it('marks an expired quote', async () => {
    const quote = await mockTboFlightAdapter.fareQuote(offer, { expired: true });
    assert.equal(quote.status, 'EXPIRED');
    assert.ok(new Date(quote.expiresAt).getTime() < Date.now());
  });

  it('returns the old and new price without applying the increase by default', async () => {
    const quote = await mockTboFlightAdapter.fareQuote(offer, { simulatePriceChange: true });
    assert.equal(quote.status, 'PRICE_CHANGED');
    assert.equal(quote.previousPrice.amount, offer.supplierPrice.amount);
    assert.equal(quote.price.amount, offer.supplierPrice.amount + 250);
  });

  it('builds segment SSR for a connection and prices two passengers', async () => {
    const connecting = getMockTboFlights({
      origin: 'DEL',
      destination: 'BLR',
      departDate: future,
      currency: 'INR',
    }).find((row) => row.stops === 1);
    const ssr = await mockTboFlightAdapter.getSsr(connecting);
    assert.equal(ssr.segments.length, 2);
    assert.equal(ssr.segments[0].segmentKey, 'DEL-HYD-0');
    assert.ok(ssr.segments[1].seats.some((seat) => seat.status === 'OCCUPIED'));
    const catalog = flightAddOnCatalog('INR');
    const first = sumSelected(
      catalog.seats,
      [{ code: '12A', passengerKey: 'p1', segmentKey: 'DEL-HYD-0' }],
      'seat',
    );
    const second = sumSelected(
      catalog.seats,
      [{ code: '12C', passengerKey: 'p2', segmentKey: 'DEL-HYD-0' }],
      'seat',
    );
    assert.equal(first.amount + second.amount, 900);
  });

  it('rejects the same seat for two passengers and an occupied seat', () => {
    const catalog = flightAddOnCatalog('INR');
    assert.throws(
      () =>
        sumSelected(
          catalog.seats,
          [
            { code: '12A', passengerKey: 'p1', segmentKey: 'DEL-BLR-0' },
            { code: '12A', passengerKey: 'p2', segmentKey: 'DEL-BLR-0' },
          ],
          'seat',
        ),
      /already selected/,
    );
    assert.throws(
      () =>
        sumSelected(
          catalog.seats,
          [{ code: '12B', passengerKey: 'p1', segmentKey: 'DEL-BLR-0' }],
          'seat',
        ),
      /not available/,
    );
  });

  it('keeps the commercial total on the pricing engine and rejects a client total', () => {
    const priced = calculatePrice({
      supplierPrice: { amount: 4150, currency: 'INR' },
      supplierCode: 'TBO',
      context: { rules: [], serviceCode: 'flight', pricingVersion: '12.0' },
    });
    assert.equal(priced.pricingVersion || priced.commercialSnapshot?.pricingVersion, '12.0');
    assert.throws(
      () => assertExactPrice({ amount: 4150, currency: 'INR' }, { amount: 1, currency: 'INR' }),
      /Price mismatch/,
    );
  });
});

describe('phase 17 mock booking contract', () => {
  const offer = { supplierOfferId: 'TBO-FARE-6E512-DELBLR', aplFareId: 'fare-1' };

  it('confirms a mock booking with a stable PNR', async () => {
    const booked = await mockTboFlightAdapter.bookFlight(offer);
    assert.equal(booked.status, 'SUCCESS');
    assert.equal(booked.pnr, 'PNRDELBLR');
    assert.equal(booked.testBooking, true);
    assert.match(booked.notice, /MOCK BOOKING/);
    const again = await mockTboFlightAdapter.bookFlight(offer);
    assert.equal(again.pnr, booked.pnr);
  });

  it('fails a simulated supplier booking without a PNR', async () => {
    const booked = await mockTboFlightAdapter.bookFlight(offer, { simulateFailure: true });
    assert.equal(booked.status, 'FAILED');
    assert.equal(booked.pnr, undefined);
  });

  it('retrieves and cancels by the same PNR', async () => {
    const booked = await mockTboFlightAdapter.bookFlight(offer);
    const retrieved = await mockTboFlightAdapter.retrieveBooking({ pnr: booked.pnr });
    const cancelled = await mockTboFlightAdapter.cancelBooking({ pnr: booked.pnr });
    assert.equal(retrieved.pnr, booked.pnr);
    assert.equal(cancelled.status, 'CANCELLED');
  });
});
