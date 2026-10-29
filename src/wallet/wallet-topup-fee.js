'use strict';

/**
 * Customer wallet top-up fee. This is not the checkout convenience fee.
 * The customer pays the requested amount. The processing fee is deducted
 * from that amount, and only the net is credited.
 * Amounts are integer paise with half-up rounding.
 */

const { normalizePaymentMethod } = require('../payments/payment-method-fee');

const CARD_BPS = 250;

function netBankingBps() {
  const raw = process.env.WALLET_TOPUP_NETBANKING_BPS;
  if (raw == null || String(raw).trim() === '') return 0;
  const rate = Number(raw);
  if (!Number.isInteger(rate) || rate < 0 || rate > 10000) return 0;
  return rate;
}

function topUpRateBps(method) {
  if (method === 'UPI') return 0;
  if (method === 'CARD') return CARD_BPS;
  if (method === 'NETBANKING') return netBankingBps();
  const error = new Error('Unsupported wallet top-up method');
  error.code = 'PAYMENT_METHOD';
  throw error;
}

function toMinor(major) {
  const amount = Number(major);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Top-up amount must be greater than zero');
  }
  const minor = Math.round(amount * 100);
  if (!Number.isInteger(minor) || minor <= 0 || minor > 10000000) {
    throw new Error('Top-up amount must be between ₹1 and ₹100,000');
  }
  return minor;
}

function fromMinor(minor) {
  return minor / 100;
}

function quoteWalletTopUp(amount, method) {
  const key = normalizePaymentMethod(method);
  if (key === 'WALLET') {
    const error = new Error('Unsupported wallet top-up method');
    error.code = 'PAYMENT_METHOD';
    throw error;
  }
  const rateBps = topUpRateBps(key);
  const paymentMinor = toMinor(amount);
  const feeMinor = Math.round((paymentMinor * rateBps) / 10000);
  const netMinor = paymentMinor - feeMinor;
  if (netMinor <= 0) {
    throw new Error('Top-up fee leaves nothing to credit');
  }
  return {
    method: key,
    rateBps,
    currency: 'INR',
    paymentAmount: fromMinor(paymentMinor),
    feeAmount: fromMinor(feeMinor),
    netCredit: fromMinor(netMinor),
    paymentMinor,
    feeMinor,
    netMinor,
    provider: 'APL_MOCK_PAY',
    demo: true,
  };
}

function mockTopUpAllowed() {
  return process.env.NODE_ENV !== 'production';
}

module.exports = {
  quoteWalletTopUp,
  mockTopUpAllowed,
  toMinor,
  fromMinor,
};
