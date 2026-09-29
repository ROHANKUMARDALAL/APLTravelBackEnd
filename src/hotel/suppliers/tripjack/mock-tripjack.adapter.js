'use strict';

const { delay, isDelhiSearch } = require('../mock.helpers');
const { getMockTripjackHotels } = require('../../data/mock-tripjack-hotels');

const mockTripjackAdapter = {
  code: 'TRIPJACK',
  displayName: 'TripJack (Mock)',
  isMock: true,

  async searchHotels(criteria, options = {}) {
    const started = Date.now();

    if (options.simulateFailure) {
      await delay(35);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated TripJack timeout',
      };
    }

    await delay(70);

    if (!isDelhiSearch(criteria.city)) {
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        hotels: [],
        rawPayload: { mock: true, supplier: 'TRIPJACK', results: [] },
      };
    }

    const hotels = getMockTripjackHotels(criteria);

    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      hotels,
      rawPayload: { mock: true, supplier: 'TRIPJACK', results: hotels },
    };
  },
};

module.exports = { mockTripjackAdapter };
