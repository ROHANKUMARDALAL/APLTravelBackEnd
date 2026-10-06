'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isServiceOffered } = require('./service-offer.service');

describe('isServiceOffered', () => {
  const base = {
    dsa: { status: 'ACTIVE' },
    service: { globalStatus: 'ACTIVE' },
    mapping: { isAllowedByAPL: true, isActiveByDSA: true },
  };

  it('returns true only when all conditions are satisfied', () => {
    assert.equal(isServiceOffered(base), true);
  });

  it('returns false when global service is inactive', () => {
    assert.equal(
      isServiceOffered({
        ...base,
        service: { globalStatus: 'INACTIVE' },
      }),
      false,
    );
  });

  it('returns false when DSA is inactive', () => {
    assert.equal(
      isServiceOffered({
        ...base,
        dsa: { status: 'SUSPENDED' },
      }),
      false,
    );
  });

  it('returns false when APL has not allowed the service', () => {
    assert.equal(
      isServiceOffered({
        ...base,
        mapping: { isAllowedByAPL: false, isActiveByDSA: true },
      }),
      false,
    );
  });

  it('returns false when DSA has not activated the service', () => {
    assert.equal(
      isServiceOffered({
        ...base,
        mapping: { isAllowedByAPL: true, isActiveByDSA: false },
      }),
      false,
    );
  });

  it('returns false when mapping is missing', () => {
    assert.equal(
      isServiceOffered({
        dsa: base.dsa,
        service: base.service,
        mapping: null,
      }),
      false,
    );
  });
});
