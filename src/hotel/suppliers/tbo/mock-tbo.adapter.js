'use strict';

const { delay, isDelhiSearch } = require('../mock.helpers');
const { getMockTboHotels } = require('../../data/mock-tbo-hotels');

const mockTboAdapter = {
  code: 'TBO',
  displayName: 'TBO (Mock)',
  isMock: true,

  async searchHotels(criteria, options = {}) {
    const started = Date.now();

    if (options.simulateFailure) {
      await delay(40);
      return {
        status: 'FAILED',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_FAILURE',
        errorMessage: 'Simulated TBO failure',
      };
    }

    await delay(55);

    if (!isDelhiSearch(criteria.city)) {
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        hotels: [],
        rawPayload: { mock: true, supplier: 'TBO', hotels: [] },
      };
    }

    const hotels = getMockTboHotels(criteria);

    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      hotels,
      rawPayload: { mock: true, supplier: 'TBO', hotels },
    };
  },
};

module.exports = { mockTboAdapter };
