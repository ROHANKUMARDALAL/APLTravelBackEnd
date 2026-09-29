'use strict';

const { delay, normalizeIata } = require('../mock.helpers');
const { getMockTripjackFlights } = require('../../data/mock-tripjack-flights');

const mockTripjackFlightAdapter = {
  code: 'TRIPJACK',
  displayName: 'TripJack Flights (Mock)',
  isMock: true,
  product: 'FLIGHT',

  async searchFlights(criteria, options = {}) {
    const started = Date.now();
    if (options.simulateFailure) {
      await delay(35);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated TripJack flight timeout',
      };
    }
    await delay(75);

    const originAirports = criteria.originAirports || [criteria.origin];
    const destinationAirports =
      criteria.destinationAirports || [criteria.destination];

    const flights = [];
    for (const origin of originAirports) {
      for (const destination of destinationAirports) {
        flights.push(
          ...getMockTripjackFlights({
            ...criteria,
            origin: normalizeIata(origin),
            destination: normalizeIata(destination),
          }),
        );
      }
    }

    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      flights,
      rawPayload: { mock: true, supplier: 'TRIPJACK', flights },
    };
  },
};

module.exports = { mockTripjackFlightAdapter };
