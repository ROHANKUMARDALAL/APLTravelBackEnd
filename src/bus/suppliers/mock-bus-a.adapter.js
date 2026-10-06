'use strict';

const { delay } = require('./mock.helpers');
const { getMockBusAInventory } = require('../data/mock-bus-a');

/**
 * Mock Bus supplier A (development/test only).
 * Deterministic SUCCESS / EMPTY / FAILURE / TIMEOUT via options.
 */
const mockBusAAdapter = {
  code: 'MOCKBUS_A',
  displayName: 'Mock Bus Network A',
  isMock: true,
  product: 'BUS',

  async searchBuses(criteria, options = {}) {
    const started = Date.now();
    const mode = String(options.simulateMode || '').toUpperCase();

    if (options.simulateFailure || mode === 'FAILURE') {
      await delay(40);
      return {
        status: 'FAILED',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_FAILURE',
        errorMessage: 'Simulated MOCKBUS_A failure',
      };
    }
    if (mode === 'TIMEOUT') {
      await delay(120);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated MOCKBUS_A timeout',
      };
    }
    if (mode === 'EMPTY') {
      await delay(50);
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        supplierRequest: { criteria },
        buses: [],
        rawPayload: { mock: true, supplier: 'MOCKBUS_A', buses: [] },
      };
    }

    await delay(55);
    const buses = getMockBusAInventory(criteria);
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      supplierRequest: { criteria, environment: options.environment || 'TEST' },
      buses,
      rawPayload: { mock: true, supplier: 'MOCKBUS_A', count: buses.length },
    };
  },
};

module.exports = { mockBusAAdapter };
