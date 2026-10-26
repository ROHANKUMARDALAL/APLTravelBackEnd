'use strict';

/**
 * Payment-method convenience fee.
 * Percentage applies to the payable amount before this fee.
 * Amounts are integer paise (or the currency's minor unit) with half-up rounding.
 * APL_MOCK_PAY is a simulated provider — these rates are not a live gateway tariff.
 */

const RATES_BPS = {
  UPI: 0,
  CARD: 250,
  NETBANKING: 300,
  WALLET: 0,
};

const MOCK_CONTROLS = {
  FORCE_FAIL: 0,
  FORCE_PENDING: 0,
};

function normalizePaymentMethod(method) {
  const key = String(method || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (key === 'NET_BANKING' || key === 'NETBANK') return 'NETBANKING';
  if (key === 'DEBIT' || key === 'CREDIT' || key === 'DEBIT_CARD' || key === 'CREDIT_CARD') return 'CARD';
  if (key === 'CUSTOMER_WALLET') return 'WALLET';
  return key;
}

function toMinor(major) {
  const amount = Number(major);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Payable amount must be a non-negative number');
  }
  return Math.round(amount * 100);
}

function fromMinor(minor) {
  return minor / 100;
}

function quotePaymentFee(baseAmount, method) {
  const key = normalizePaymentMethod(method);
  const known = Object.prototype.hasOwnProperty.call(RATES_BPS, key);
  const control = Object.prototype.hasOwnProperty.call(MOCK_CONTROLS, key);
  if (!known && !control) {
    const error = new Error('Unsupported payment method');
    error.code = 'PAYMENT_METHOD';
    throw error;
  }
  const rateBps = known ? RATES_BPS[key] : MOCK_CONTROLS[key];
  const baseMinor = toMinor(baseAmount);
  const feeMinor = Math.round((baseMinor * rateBps) / 10000);
  return {
    method: key,
    rateBps,
    baseAmount: fromMinor(baseMinor),
    feeAmount: fromMinor(feeMinor),
    totalAmount: fromMinor(baseMinor + feeMinor),
    simulated: true,
    provider: 'APL_MOCK_PAY',
  };
}

module.exports = {
  RATES_BPS,
  normalizePaymentMethod,
  quotePaymentFee,
  toMinor,
  fromMinor,
};
