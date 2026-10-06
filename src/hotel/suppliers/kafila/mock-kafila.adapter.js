'use strict';

const { delay, isDelhiSearch } = require('../mock.helpers');
const { getMockKafilaHotels } = require('../../data/mock-kafila-hotels');

const mockKafilaAdapter = {
  code: 'KAFILA',
  displayName: 'Kafila (Mock)',
  isMock: true,

  async searchHotels(criteria, options = {}) {
    const started = Date.now();

    if (options.simulateFailure) {
      await delay(30);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated Kafila timeout',
      };
    }

    await delay(90);

    if (!isDelhiSearch(criteria.city)) {
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        hotels: [],
        rawPayload: { mock: true, supplier: 'KAFILA', data: [] },
      };
    }

    const hotels = getMockKafilaHotels(criteria);

    const supplierRequest = {
      environment: options.environment || 'TEST',
      criteria,
    };
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      supplierRequest,
      hotels,
      rawPayload: { mock: true, supplier: 'KAFILA', data: hotels },
    };
  },
};

module.exports = { mockKafilaAdapter };
