'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateRefund,
  snapshotTotals,
} = require('./refund-calc.service');
const {
  resolveChargeAmount,
  assertNoClientAmountTamper,
} = require('./payment.service');
const { PaymentStatus, normalizePaymentStatus } = require('../status');
const { AppError } = require('../../common/errors/app-error');

describe('Phase 13 refund calculation', () => {
  it('uses booking commercialSnapshot finalPrice (not live recalculation)', () => {
    const booking = {
      totalAmount: 99999,
      currency: 'INR',
      commercialSnapshot: {
        finalPrice: { amount: 3983.95, currency: 'INR' },
        aplMarkup: { amount: 200 },
        dsaMarkup: { amount: 100 },
        pricingVersion: '12.0',
      },
    };
    const calc = calculateRefund({ booking, kind: 'FULL' });
    assert.equal(calc.ok, true);
    assert.equal(calc.approvedAmount, 3983.95);
    assert.equal(calc.breakdown.source, 'booking.commercialSnapshot');
    assert.equal(calc.breakdown.aplMarkup.amount, 200);
    assert.equal(calc.mockRule, 'DEV_FULL_SNAPSHOT_REFUND_NO_SUPPLIER_PENALTY');
  });

  it('supports partial refund foundation capped by snapshot', () => {
    const booking = {
      totalAmount: 5000,
      currency: 'INR',
      commercialSnapshot: {
        finalPrice: { amount: 5000, currency: 'INR' },
      },
    };
    const ok = calculateRefund({
      booking,
      kind: 'PARTIAL',
      requestedAmount: 1500,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.kind, 'PARTIAL');
    assert.equal(ok.approvedAmount, 1500);

    const over = calculateRefund({
      booking,
      kind: 'PARTIAL',
      requestedAmount: 6000,
    });
    assert.equal(over.ok, false);
  });

  it('falls back safely for legacy booking without snapshot', () => {
    const booking = { totalAmount: 1200, currency: 'INR' };
    const totals = snapshotTotals(null, booking);
    assert.equal(totals.amount, 1200);
    const calc = calculateRefund({ booking, kind: 'FULL' });
    assert.equal(calc.breakdown.source, 'booking.totalAmount_legacy_fallback');
  });
});

describe('Phase 13 server-authoritative payment amount', () => {
  const session = {
    pricing: { amount: 3983.95, currency: 'INR' },
    commercialSnapshot: {
      finalPrice: { amount: 3983.95, currency: 'INR' },
    },
  };

  it('resolves charge from commercialSnapshot.finalPrice', () => {
    const charge = resolveChargeAmount(session);
    assert.equal(charge.amount, 3983.95);
    assert.equal(charge.currency, 'INR');
  });

  it('rejects tampered client payment.amount', () => {
    assert.throws(
      () => assertNoClientAmountTamper(session, { amount: 100 }),
      (err) => err instanceof AppError && /mismatch/i.test(err.message),
    );
  });

  it('allows omit of client amount (server authoritative)', () => {
    assert.doesNotThrow(() =>
      assertNoClientAmountTamper(session, { method: 'CARD' }),
    );
  });
});

describe('Phase 13 payment status normalization', () => {
  it('maps legacy CAPTURED to SUCCESS', () => {
    assert.equal(normalizePaymentStatus('CAPTURED'), PaymentStatus.SUCCESS);
    assert.equal(normalizePaymentStatus('AUTHORIZED'), PaymentStatus.SUCCESS);
    assert.equal(normalizePaymentStatus('SUCCESS'), PaymentStatus.SUCCESS);
  });
});
