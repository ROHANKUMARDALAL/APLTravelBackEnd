'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hasPermission, Permission } = require('./permissions');

describe('hasPermission', () => {
  it('allows when permission is present', () => {
    assert.equal(
      hasPermission([Permission.DSA_VIEW, Permission.AUDIT_VIEW], Permission.AUDIT_VIEW),
      true,
    );
  });

  it('denies when permission is missing', () => {
    assert.equal(
      hasPermission([Permission.DSA_VIEW], Permission.AUDIT_VIEW),
      false,
    );
  });

  it('requires all listed permissions', () => {
    assert.equal(
      hasPermission(
        [Permission.DSA_VIEW, Permission.DSA_CREATE],
        [Permission.DSA_VIEW, Permission.DSA_CREATE],
      ),
      true,
    );
    assert.equal(
      hasPermission([Permission.DSA_VIEW], [Permission.DSA_VIEW, Permission.DSA_CREATE]),
      false,
    );
  });
});
