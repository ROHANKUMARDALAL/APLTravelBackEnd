'use strict';

const { SUPPLIER_CODES } = require('../../common/config');
const { mockTboAdapter } = require('./tbo/mock-tbo.adapter');
const { mockTripjackAdapter } = require('./tripjack/mock-tripjack.adapter');
const { mockKafilaAdapter } = require('./kafila/mock-kafila.adapter');

const adapters = [mockTboAdapter, mockTripjackAdapter, mockKafilaAdapter];
const byCode = new Map(adapters.map((a) => [a.code, a]));

function getAllAdapters() {
  return SUPPLIER_CODES.map((code) => {
    const adapter = byCode.get(code);
    if (!adapter) throw new Error(`Missing supplier adapter for ${code}`);
    return adapter;
  });
}

function getAdapter(code) {
  const adapter = byCode.get(code);
  if (!adapter) throw new Error(`Unknown supplier: ${code}`);
  return adapter;
}

function listSupplierMeta() {
  return getAllAdapters().map((a) => ({
    code: a.code,
    name: a.displayName,
    isMock: a.isMock,
    status: 'ACTIVE',
  }));
}

module.exports = {
  getAllAdapters,
  getAdapter,
  listSupplierMeta,
};
