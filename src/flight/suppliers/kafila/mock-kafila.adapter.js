'use strict';

const { delay, normalizeIata } = require('../mock.helpers');
const { getMockKafilaFlights } = require('../../data/mock-kafila-flights');

const mockKafilaFlightAdapter = {
  code: 'KAFILA',
  displayName: 'Kafila Flights (Mock)',
  isMock: true,
  product: 'FLIGHT',

  async searchFlights(criteria, options = {}) {
    const started = Date.now();
    if (options.simulateFailure) {
      await delay(30);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated Kafila flight timeout',
      };
    }
    await delay(85);

    const originAirports = criteria.originAirports || [criteria.origin];
    const destinationAirports =
      criteria.destinationAirports || [criteria.destination];

    const flights = [];
    for (const origin of originAirports) {
      for (const destination of destinationAirports) {
        flights.push(
          ...getMockKafilaFlights({
            ...criteria,
            origin: normalizeIata(origin),
            destination: normalizeIata(destination),
          }),
        );
      }
    }

    const supplierRequest = {
      environment: options.environment || 'TEST',
      criteria,
    };
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      supplierRequest,
      flights,
      rawPayload: { mock: true, supplier: 'KAFILA', flights },
    };
  },
};

module.exports = { mockKafilaFlightAdapter };
