'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPaymentProvider } = require('./mock.provider');

describe('mock payment provider', () => {
  it('approves UPI when the checkout screen does not collect a VPA', async () => {
    const result = await mockPaymentProvider.createPayment({
      amount: 7000,
      currency: 'INR',
      method: 'UPI',
      instrument: {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'SUCCESS');
  });

  it('declines the development UPI failure control', async () => {
    const result = await mockPaymentProvider.createPayment({
      amount: 7000,
      currency: 'INR',
      method: 'UPI',
      instrument: { upiId: 'fail@aplmock' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.failureReason, 'Invalid UPI id');
  });

  it('declines a UPI id that is not a VPA', async () => {
    const result = await mockPaymentProvider.createPayment({
      amount: 7000,
      currency: 'INR',
      method: 'UPI',
      instrument: { upiId: 'not-a-vpa' },
    });
    assert.equal(result.ok, false);
  });
});
