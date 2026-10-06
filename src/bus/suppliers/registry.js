'use strict';

const { mockBusAAdapter } = require('./mock-bus-a.adapter');
const { mockBusBAdapter } = require('./mock-bus-b.adapter');

/**
 * Bus supplier registry (Phase 14A — mock only).
 * Real Bus adapters register later without rewriting search/book orchestration.
 */
const byCode = new Map([
  [mockBusAAdapter.code, mockBusAAdapter],
  [mockBusBAdapter.code, mockBusBAdapter],
]);

function registerBusAdapter(adapter) {
  if (!adapter?.code) throw new Error('Bus adapter requires a stable code');
  if (typeof adapter.searchBuses !== 'function') {
    throw new Error(`Bus adapter ${adapter.code} must implement searchBuses`);
  }
  byCode.set(String(adapter.code).toUpperCase(), adapter);
  return adapter;
}

function getBusAdapter(code) {
  return byCode.get(String(code || '').toUpperCase()) || null;
}

function getAllBusAdapters() {
  return Array.from(byCode.values());
}

function listBusSupplierMeta() {
  return getAllBusAdapters().map((a) => ({
    code: a.code,
    name: a.displayName,
    isMock: Boolean(a.isMock),
    product: 'BUS',
    status: 'ACTIVE',
  }));
}

module.exports = {
  getAllBusAdapters,
  getBusAdapter,
  registerBusAdapter,
  listBusSupplierMeta,
};
