'use strict';

const { SUPPLIER_CODES } = require('../../common/config');
const { mockTboFlightAdapter } = require('./tbo/mock-tbo.adapter');
const { mockTripjackFlightAdapter } = require('./tripjack/mock-tripjack.adapter');
const { mockKafilaFlightAdapter } = require('./kafila/mock-kafila.adapter');

/**
 * Flight supplier registry (Phase 10 + 11A).
 * Mocks remain registered. Real adapters register by code via registerFlightAdapter
 * when Phase 11B documentation/credentials are available — do not invent them here.
 */
const byCode = new Map([
  [mockTboFlightAdapter.code, mockTboFlightAdapter],
  [mockTripjackFlightAdapter.code, mockTripjackFlightAdapter],
  [mockKafilaFlightAdapter.code, mockKafilaFlightAdapter],
]);

function registerFlightAdapter(adapter) {
  if (!adapter || !adapter.code) {
    throw new Error('Flight adapter requires a stable code');
  }
  if (typeof adapter.searchFlights !== 'function') {
    throw new Error(`Flight adapter ${adapter.code} must implement searchFlights`);
  }
  byCode.set(String(adapter.code).toUpperCase(), adapter);
  return adapter;
}

function getFlightAdapter(code) {
  return byCode.get(String(code || '').toUpperCase()) || null;
}

function getAllFlightAdapters() {
  // Prefer configured SUPPLIER_CODES order; append any extra registered codes.
  const ordered = [];
  const seen = new Set();
  for (const code of SUPPLIER_CODES) {
    const adapter = byCode.get(code);
    if (adapter) {
      ordered.push(adapter);
      seen.add(code);
    }
  }
  for (const [code, adapter] of byCode.entries()) {
    if (!seen.has(code)) ordered.push(adapter);
  }
  return ordered;
}

function listFlightSupplierMeta() {
  return getAllFlightAdapters().map((a) => ({
    code: a.code,
    name: a.displayName,
    isMock: Boolean(a.isMock),
    product: 'FLIGHT',
    status: 'ACTIVE',
  }));
}

module.exports = {
  getAllFlightAdapters,
  getFlightAdapter,
  registerFlightAdapter,
  listFlightSupplierMeta,
};
