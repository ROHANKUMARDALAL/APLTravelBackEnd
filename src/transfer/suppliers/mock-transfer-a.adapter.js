'use strict';

const { delay } = require('./mock.helpers');
const { getMockTransferAInventory } = require('../data/mock-transfer-a');

const mockTransferAAdapter = {
  code: 'MOCKXFER_A',
  displayName: 'Mock Transfer Network A',
  isMock: true,
  product: 'TRANSFER',

  async searchTransfers(criteria, options = {}) {
    const started = Date.now();
    const mode = String(options.simulateMode || '').toUpperCase();

    if (options.simulateFailure || mode === 'FAILURE') {
      await delay(40);
      return {
        status: 'FAILED',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_FAILURE',
        errorMessage: 'Simulated MOCKXFER_A failure',
      };
    }
    if (mode === 'TIMEOUT') {
      await delay(120);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated MOCKXFER_A timeout',
      };
    }
    if (mode === 'EMPTY') {
      await delay(50);
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        supplierRequest: { criteria },
        transfers: [],
        rawPayload: { mock: true, supplier: 'MOCKXFER_A', transfers: [] },
      };
    }

    await delay(55);
    const transfers = getMockTransferAInventory(criteria);
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      supplierRequest: { criteria, environment: options.environment || 'TEST' },
      transfers,
      rawPayload: { mock: true, supplier: 'MOCKXFER_A', count: transfers.length },
    };
  },
};

module.exports = { mockTransferAAdapter };
