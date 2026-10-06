'use strict';

const { delay } = require('./mock.helpers');
const { getMockTransferBInventory } = require('../data/mock-transfer-b');

const mockTransferBAdapter = {
  code: 'MOCKXFER_B',
  displayName: 'Mock Transfer Network B',
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
        errorMessage: 'Simulated MOCKXFER_B failure',
      };
    }
    if (mode === 'TIMEOUT') {
      await delay(120);
      return {
        status: 'TIMEOUT',
        durationMs: Date.now() - started,
        errorCode: 'MOCK_SUPPLIER_TIMEOUT',
        errorMessage: 'Simulated MOCKXFER_B timeout',
      };
    }
    if (mode === 'EMPTY') {
      await delay(50);
      return {
        status: 'SUCCESS',
        durationMs: Date.now() - started,
        supplierRequest: { criteria },
        transfers: [],
        rawPayload: { mock: true, supplier: 'MOCKXFER_B', transfers: [] },
      };
    }

    await delay(60);
    const transfers = getMockTransferBInventory(criteria);
    return {
      status: 'SUCCESS',
      durationMs: Date.now() - started,
      supplierRequest: { criteria, environment: options.environment || 'TEST' },
      transfers,
      rawPayload: { mock: true, supplier: 'MOCKXFER_B', count: transfers.length },
    };
  },
};

module.exports = { mockTransferBAdapter };
