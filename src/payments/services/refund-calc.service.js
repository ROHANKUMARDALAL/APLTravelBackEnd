'use strict';

/**
 * Central refund calculation (Phase 13).
 *
 * Uses Booking.commercialSnapshot only — never recalculates with today's rules.
 * Mock development rules (no real airline/hotel penalties yet):
 * - FULL: refund finalPrice (customer paid amount)
 * - PARTIAL: refund an explicit approvedAmount ≤ finalPrice
 *
 * Breakdown keeps APL / DSA markup / service fee / discount fields for later
 * supplier-penalty integration without inventing real rules now.
 */

function snapshotTotals(commercialSnapshot, booking) {
  const snap = commercialSnapshot || {};
  const finalPrice = snap.finalPrice || {};
  const amount = Number(
    finalPrice.amount ?? booking?.totalAmount ?? 0,
  );
  const currency = String(
    finalPrice.currency || booking?.currency || 'INR',
  ).toUpperCase();
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    supplierNet: snap.supplierNet || null,
    aplMarkup: snap.aplMarkup || null,
    dsaMarkup: snap.dsaMarkup || null,
    serviceFee: snap.serviceFee || null,
    discount: snap.discount || null,
    pricingVersion: snap.pricingVersion || null,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.booking
 * @param {'FULL'|'PARTIAL'} [opts.kind]
 * @param {number} [opts.requestedAmount] — required for PARTIAL
 * @param {object} [opts.supplierQuote] — reserved for future supplier refund quote
 */
function calculateRefund({
  booking,
  kind = 'FULL',
  requestedAmount,
  supplierQuote = null,
}) {
  const totals = snapshotTotals(booking.commercialSnapshot, booking);
  const k = String(kind || 'FULL').toUpperCase() === 'PARTIAL' ? 'PARTIAL' : 'FULL';

  // Future: supplierQuote.refundableAmount / penaltyAmount plug in here.
  // Mock: no supplier penalty — full customer amount is refundable unless PARTIAL.
  const maxRefundable = totals.amount;
  let approved = maxRefundable;

  if (k === 'PARTIAL') {
    const req = Number(requestedAmount);
    if (!Number.isFinite(req) || req <= 0) {
      return {
        ok: false,
        error: 'PARTIAL refund requires a positive requestedAmount',
      };
    }
    if (req > maxRefundable) {
      return {
        ok: false,
        error: `requestedAmount ${req} exceeds refundable ${maxRefundable}`,
      };
    }
    approved = req;
  }

  if (supplierQuote && Number.isFinite(Number(supplierQuote.refundableAmount))) {
    // Soft ceiling when a future supplier quote exists — still mock-safe.
    approved = Math.min(approved, Number(supplierQuote.refundableAmount));
  }

  return {
    ok: true,
    kind: k,
    requestedAmount: k === 'PARTIAL' ? Number(requestedAmount) : maxRefundable,
    approvedAmount: approved,
    currency: totals.currency,
    maxRefundable,
    mockRule: 'DEV_FULL_SNAPSHOT_REFUND_NO_SUPPLIER_PENALTY',
    breakdown: {
      source: booking.commercialSnapshot
        ? 'booking.commercialSnapshot'
        : 'booking.totalAmount_legacy_fallback',
      finalPrice: totals.amount,
      currency: totals.currency,
      supplierNet: totals.supplierNet,
      aplMarkup: totals.aplMarkup,
      dsaMarkup: totals.dsaMarkup,
      serviceFee: totals.serviceFee,
      discount: totals.discount,
      pricingVersion: totals.pricingVersion,
      supplierPenalty: 0,
      supplierQuote: supplierQuote || null,
      note:
        'Mock rule: no real airline/hotel cancellation penalties. Architecture ready for supplier refund quotes.',
    },
  };
}

module.exports = { calculateRefund, snapshotTotals };
