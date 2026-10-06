'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { PaymentStatus, RefundStatus } = require('../status');

/**
 * Mock payment provider (development/test only).
 * Deterministic:
 * - CARD ending 0000 → FAIL
 * - method FORCE_FAIL → FAIL
 * - method FORCE_PENDING → PENDING
 * - else SUCCESS
 */
const mockPaymentProvider = {
  code: 'APL_MOCK_PAY',
  isMock: true,

  async createPayment({ amount, currency, method, instrument = {}, metadata = {} }) {
    if (config.isProduction) {
      return {
        ok: false,
        status: PaymentStatus.FAILED,
        failureReason: 'Mock payment provider is not allowed in production',
      };
    }

    const m = String(method || 'CARD').toUpperCase();
    if (m === 'FORCE_FAIL') {
      return {
        ok: false,
        status: PaymentStatus.FAILED,
        failureReason: 'Forced mock payment failure',
        providerRef: `MOCKFAIL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      };
    }
    if (m === 'FORCE_PENDING') {
      return {
        ok: true,
        status: PaymentStatus.PENDING,
        providerRef: `MOCKPEND-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        providerMeta: { pending: true },
      };
    }
    if (m === 'CARD') {
      const digits = String(instrument.cardNumber || '').replace(/\D/g, '');
      if (digits.endsWith('0000')) {
        return {
          ok: false,
          status: PaymentStatus.FAILED,
          failureReason: 'Mock card declined (cards ending in 0000 fail)',
          last4: digits.slice(-4) || '0000',
        };
      }
      return {
        ok: true,
        status: PaymentStatus.SUCCESS,
        providerRef: `MOCKPAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        last4: digits.slice(-4) || '4242',
        providerMeta: { method: 'CARD' },
      };
    }
    if (m === 'UPI') {
      if (!instrument.upiId || !String(instrument.upiId).includes('@')) {
        return {
          ok: false,
          status: PaymentStatus.FAILED,
          failureReason: 'Invalid UPI id',
        };
      }
      return {
        ok: true,
        status: PaymentStatus.SUCCESS,
        providerRef: `MOCKUPI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        providerMeta: { method: 'UPI' },
      };
    }
    return {
      ok: true,
      status: PaymentStatus.SUCCESS,
      providerRef: `MOCKPAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      providerMeta: { method: m, amount, currency, ...metadata },
    };
  },

  async refundPayment({ amount, currency, providerRef, reason }) {
    if (config.isProduction) {
      return {
        ok: false,
        status: RefundStatus.FAILED,
        failureReason: 'Mock refund provider is not allowed in production',
      };
    }
    if (String(reason || '').toUpperCase() === 'FORCE_REFUND_FAIL') {
      return {
        ok: false,
        status: RefundStatus.FAILED,
        failureReason: 'Forced mock refund failure',
      };
    }
    return {
      ok: true,
      status: RefundStatus.SUCCESS,
      providerRefundRef: `MOCKRF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      providerMeta: { amount, currency, originalProviderRef: providerRef },
    };
  },
};

module.exports = { mockPaymentProvider };
