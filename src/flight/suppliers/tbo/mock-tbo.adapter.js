'use strict';

const { delay, normalizeIata } = require('../mock.helpers');
const { getMockTboFlights } = require('../../data/mock-tbo-flights');

const mockTboFlightAdapter = {
  code: 'TBO',
  displayName: 'TBO Flights (Mock)',
  isMock: true,
  product: 'FLIGHT',

  async searchFlights(criteria, options = {}) {
    const started = Date.now();
    if (options.simulateFailure) {
      await delay(40);
      return {
        status: 'FAILED',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_FAILURE',
        errorMessage: 'Simulated TBO flight failure',
      };
    }
    await delay(60);

    const originAirports = criteria.originAirports || [criteria.origin];
    const destinationAirports =
      criteria.destinationAirports || [criteria.destination];

    const flights = [];
    for (const origin of originAirports) {
      for (const destination of destinationAirports) {
        flights.push(
          ...getMockTboFlights({
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
      rawPayload: { mock: true, supplier: 'TBO', flights },
    };
  },
};

module.exports = { mockTboFlightAdapter };
