'use strict';

process.env.NODE_ENV = 'test';
process.env.COMMON_SUPPLIER_GATEWAY_ENABLED = '1';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { connectorForSupplier } = require('./connector-bridge');

describe('connector bridge', () => {
  it('keeps mock suppliers on the existing adapters', () => {
    const decision = connectorForSupplier({ code: 'TBO', integrationStatus: 'MOCK' });
    assert.equal(decision.useConnector, false);
    assert.equal(decision.blocked, false);
  });

  it('does not call placeholder or disabled suppliers', () => {
    assert.equal(connectorForSupplier({ code: 'TBO', integrationStatus: 'PLACEHOLDER' }).blocked, true);
    assert.equal(connectorForSupplier({ code: 'TBO', integrationStatus: 'DISABLED' }).blocked, true);
  });
});
