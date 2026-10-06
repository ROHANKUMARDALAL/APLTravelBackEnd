'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripClientTenantSelectors,
  assertBookingTenantAccess,
  assertSearchTenantMatch,
  assertCheckoutTenantMatch,
} = require('./transaction-tenant.service');

describe('transaction tenant helpers', () => {
  it('strips client dsaId from body/query/headers', () => {
    const req = {
      body: { dsaId: 'evil', originCityCode: 'DEL' },
      query: { dsa_id: 'evil2' },
      headers: { 'x-dsa-id': 'evil3', host: 'localhost:3001' },
    };
    stripClientTenantSelectors(req);
    assert.equal(req.body.dsaId, undefined);
    assert.equal(req.body.originCityCode, 'DEL');
    assert.equal(req.query.dsa_id, undefined);
    assert.equal(req.headers['x-dsa-id'], undefined);
    assert.equal(req.headers.host, 'localhost:3001');
  });

  it('allows legacy booking without dsaId', () => {
    const result = assertBookingTenantAccess(
      { dsaId: null },
      { dsaId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    );
    assert.equal(result.mode, 'legacy');
  });

  it('rejects booking tenant mismatch', () => {
    assert.throws(
      () =>
        assertBookingTenantAccess(
          { dsaId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
          { dsaId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
        ),
      (err) => err.code === 'FORBIDDEN',
    );
  });

  it('rejects search/checkout when tenant mismatches', () => {
    assert.throws(
      () =>
        assertSearchTenantMatch(
          { dsaId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
          { dsaId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
        ),
      (err) => err.code === 'FORBIDDEN',
    );
    assert.throws(
      () =>
        assertCheckoutTenantMatch(
          { dsaId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
          { dsaId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
        ),
      (err) => err.code === 'FORBIDDEN',
    );
  });
});
