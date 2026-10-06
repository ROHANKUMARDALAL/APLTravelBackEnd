'use strict';

/**
 * Payment / cancellation / refund status vocabularies.
 * Canonical source: @apl/shared-domain (Phase 15D).
 * Booking.status remains separate from payment status.
 */

const {
  PaymentStatus,
  CancellationStatus,
  RefundStatus,
  BookingConfirmStatus,
  normalizePaymentStatus,
} = require('@apl/shared-domain');

module.exports = {
  PaymentStatus,
  CancellationStatus,
  RefundStatus,
  BookingConfirmStatus,
  normalizePaymentStatus,
};
