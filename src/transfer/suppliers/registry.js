'use strict';

const { mockTransferAAdapter } = require('./mock-transfer-a.adapter');
const { mockTransferBAdapter } = require('./mock-transfer-b.adapter');

const byCode = new Map([
  [mockTransferAAdapter.code, mockTransferAAdapter],
  [mockTransferBAdapter.code, mockTransferBAdapter],
]);

function registerTransferAdapter(adapter) {
  if (!adapter?.code) throw new Error('Transfer adapter requires a stable code');
  if (typeof adapter.searchTransfers !== 'function') {
    throw new Error(
      `Transfer adapter ${adapter.code} must implement searchTransfers`,
    );
  }
  byCode.set(String(adapter.code).toUpperCase(), adapter);
  return adapter;
}

function getTransferAdapter(code) {
  return byCode.get(String(code || '').toUpperCase()) || null;
}

function getAllTransferAdapters() {
  return Array.from(byCode.values());
}

function listTransferSupplierMeta() {
  return getAllTransferAdapters().map((a) => ({
    code: a.code,
    name: a.displayName,
    isMock: Boolean(a.isMock),
    product: 'TRANSFER',
    status: 'ACTIVE',
  }));
}

module.exports = {
  getAllTransferAdapters,
  getTransferAdapter,
  registerTransferAdapter,
  listTransferSupplierMeta,
};
