'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { quotePaymentFee } = require('./payment-method-fee');
const { canChangePoints, zonedDeparture } = require('../bus/utils/point-window');

describe('payment method fees', () => {
  const base = 10000;

  it('charges UPI and wallet at 0%', () => {
    for (const method of ['UPI', 'WALLET', 'upi', 'customer wallet']) {
      const quote = quotePaymentFee(base, method);
      assert.equal(quote.feeAmount, 0);
      assert.equal(quote.totalAmount, 10000);
    }
  });

  it('charges cards at 2.5% in integer paise', () => {
    const quote = quotePaymentFee(base, 'CARD');
    assert.equal(quote.feeAmount, 250);
    assert.equal(quote.totalAmount, 10250);
  });

  it('charges net banking at 3%', () => {
    const quote = quotePaymentFee(base, 'NETBANKING');
    assert.equal(quote.feeAmount, 300);
    assert.equal(quote.totalAmount, 10300);
  });

  it('rejects an unknown method', () => {
    assert.throws(() => quotePaymentFee(base, 'PAYPAL'), /Unsupported payment method/);
  });
});

describe('bus point change window', () => {
  const departure = new Date('2026-11-12T16:30:00.000Z');

  it('allows a change more than 2 hours before departure', () => {
    assert.equal(canChangePoints(departure, new Date(departure.getTime() - (2 * 60 * 60 * 1000) - 1)), true);
  });

  it('allows a change at exactly 2 hours', () => {
    assert.equal(canChangePoints(departure, new Date(departure.getTime() - 2 * 60 * 60 * 1000)), true);
  });

  it('rejects a change inside 2 hours and after departure', () => {
    assert.equal(canChangePoints(departure, new Date(departure.getTime() - 2 * 60 * 60 * 1000 + 1)), false);
    assert.equal(canChangePoints(departure, new Date(departure.getTime() + 1000)), false);
  });

  it('builds a Delhi departure instant in Asia/Kolkata', () => {
    const at = zonedDeparture('2026-11-12', '22:00', 'Asia/Kolkata');
    assert.equal(at.toISOString(), '2026-11-12T16:30:00.000Z');
  });
});
