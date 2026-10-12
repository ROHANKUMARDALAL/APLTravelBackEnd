'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { displayFlightNumber } = require('./flight-normalization');

describe('displayFlightNumber', () => {
  it('formats a supplier code and number once', () => {
    assert.equal(displayFlightNumber('6E', '203'), '6E 203');
    assert.equal(displayFlightNumber('AI', 'AI865'), 'AI 865');
    assert.equal(displayFlightNumber('6E', '6E6E203'), '6E 203');
    assert.equal(displayFlightNumber('AI', '0865'), 'AI 865');
  });

  it('keeps a different number on each segment and does not copy one number onto every leg', () => {
    const { segmentDisplay } = require('./flight-normalization');
    const canonical = { airlineCode: 'EK', flightNumber: '513' };
    const first = segmentDisplay({ airlineCode: 'EK', flightNumber: '513' }, canonical, 2);
    const second = segmentDisplay({ airlineCode: 'EK', flightNumber: '001' }, canonical, 2);
    const unlabeled = segmentDisplay({ origin: 'DXB', destination: 'LHR' }, canonical, 2);
    assert.equal(first, 'EK 513');
    assert.equal(second, 'EK 1');
    assert.equal(unlabeled, '');
    assert.equal(segmentDisplay({ origin: 'DEL', destination: 'BOM' }, canonical, 1), 'EK 513');
  });
});
