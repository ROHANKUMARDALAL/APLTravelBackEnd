'use strict';

const BookingStatus = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});

const HoldStatus = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  HELD: 'HELD',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});

module.exports = {
  BookingStatus,
  HoldStatus,
};
