'use strict';

const { SUPPLIER_CODES } = require('../../common/config');
const { mockTboFlightAdapter } = require('./tbo/mock-tbo.adapter');
const { mockTripjackFlightAdapter } = require('./tripjack/mock-tripjack.adapter');
const { mockKafilaFlightAdapter } = require('./kafila/mock-kafila.adapter');

const adapters = [
  mockTboFlightAdapter,
  mockTripjackFlightAdapter,
  mockKafilaFlightAdapter,
];
const byCode = new Map(adapters.map((a) => [a.code, a]));

function getAllFlightAdapters() {
  return SUPPLIER_CODES.map((code) => {
    const adapter = byCode.get(code);
    if (!adapter) throw new Error(`Missing flight supplier adapter for ${code}`);
    return adapter;
  });
}

function listFlightSupplierMeta() {
  return getAllFlightAdapters().map((a) => ({
    code: a.code,
    name: a.displayName,
    isMock: a.isMock,
    product: 'FLIGHT',
    status: 'ACTIVE',
  }));
}

module.exports = { getAllFlightAdapters, listFlightSupplierMeta };
