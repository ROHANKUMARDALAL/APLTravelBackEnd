'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { canChangePoints } = require('./utils/point-window');

describe('invalid point selection rules', () => {
  it('treats a missing departure timestamp as not changeable', () => {
    assert.equal(canChangePoints(null, new Date()), false);
    assert.equal(canChangePoints('not-a-date', new Date()), false);
  });
});
