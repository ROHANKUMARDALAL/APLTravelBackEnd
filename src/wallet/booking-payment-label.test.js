'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bookingPaymentLabel, normalizeServiceCode } = require('./booking-payment-label');

test('booking payment labels use the stored service code', () => {
  assert.equal(bookingPaymentLabel('flight'), 'Booking Payment (Flight)');
  assert.equal(bookingPaymentLabel('HOTEL'), 'Booking Payment (Hotel)');
  assert.equal(bookingPaymentLabel('bus'), 'Booking Payment (Bus)');
  assert.equal(bookingPaymentLabel('transfer'), 'Booking Payment (Cab)');
  assert.equal(bookingPaymentLabel('insurance'), 'Booking Payment (Insurance)');
  assert.equal(bookingPaymentLabel('flight', true), 'Booking payment reversal (Flight)');
});

test('missing service codes stay unlabeled', () => {
  assert.equal(normalizeServiceCode(''), '');
  assert.equal(normalizeServiceCode('BOOKING'), '');
  assert.equal(normalizeServiceCode('wallet'), '');
  assert.equal(bookingPaymentLabel(''), 'Booking Payment');
  assert.equal(bookingPaymentLabel('BOOKING'), 'Booking Payment');
  assert.equal(bookingPaymentLabel('', true), 'Booking payment reversal');
});
