'use strict';

const { delay } = require('./mock.helpers');
const { getMockBusBInventory } = require('../data/mock-bus-b');

/**
 * Mock Bus supplier B (development/test only).
 * Overlaps some routes with MOCKBUS_A for consolidation tests.
 */
const mockBusBAdapter = {
  code: 'MOCKBUS_B',
  displayName: 'Mock Bus Network B',
  isMock: true,
  product: 'BUS',

  async searchBuses(criteria, options = {}) {
    const started = Date.now();
    const mode = String(options.simulateMode || '').toUpperCase();

    if (options.simulateFailure || mode === 'FAILURE') {
      await delay(35);
      return {
        status: 'FAILED',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_FAILURE',
        errorMessage: 'Simulated MOCKBUS_B failure',
      };
    }
    if (mode === 'TIMEOUT') {
      await delay(110);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated MOCKBUS_B timeout',
      };
    }
    if (mode === 'EMPTY') {
      await delay(45);
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        supplierRequest: { criteria },
        buses: [],
        rawPayload: { mock: true, supplier: 'MOCKBUS_B', buses: [] },
      };
    }

    await delay(70);
    const buses = getMockBusBInventory(criteria);
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      supplierRequest: { criteria, environment: options.environment || 'TEST' },
      buses,
      rawPayload: { mock: true, supplier: 'MOCKBUS_B', count: buses.length },
    };
  },
};

module.exports = { mockBusBAdapter };
