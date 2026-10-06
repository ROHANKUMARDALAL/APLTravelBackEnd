'use strict';

const PaymentStatus = Object.freeze({
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_PENDING',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  CAPTURED: 'CAPTURED',
  AUTHORIZED: 'AUTHORIZED',
});

const CancellationStatus = Object.freeze({
  REQUESTED: 'REQUESTED',
  PROCESSING: 'PROCESSING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
});

const RefundStatus = Object.freeze({
  REQUESTED: 'REQUESTED',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const BookingConfirmStatus = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  ATTEMPTED: 'ATTEMPTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
});

function normalizePaymentStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'CAPTURED' || s === 'AUTHORIZED') return PaymentStatus.SUCCESS;
  return s || PaymentStatus.PENDING;
}

module.exports = {
  PaymentStatus,
  CancellationStatus,
  RefundStatus,
  BookingConfirmStatus,
  normalizePaymentStatus,
};
