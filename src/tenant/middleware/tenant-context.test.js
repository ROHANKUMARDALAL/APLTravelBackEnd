'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  attachTenantContext,
  resolveTenantDsaId,
  requireTenantContext,
} = require('./tenant-context');

describe('tenant-context foundation', () => {
  it('resolves dsaId only from attached tenant context', () => {
    const req = {};
    attachTenantContext(req, { dsaId: 'abc123', dsaCode: 'APL-DSA-0001' });
    assert.equal(resolveTenantDsaId(req), 'abc123');
  });

  it('rejects missing tenant context', () => {
    assert.throws(() => resolveTenantDsaId({}), /Tenant context is required/);
  });

  it('requireTenantContext calls next with error when missing', async () => {
    let err = null;
    await new Promise((resolve) => {
      requireTenantContext({}, {}, (error) => {
        err = error;
        resolve();
      });
    });
    assert.ok(err);
    assert.equal(err.httpStatus, 401);
  });
});
