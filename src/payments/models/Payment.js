'use strict';

/**
 * Payment transaction model — re-export from Booking foundation.
 * Schema is defined once in common/database/models/Booking.js (Phase 13 extended).
 */
const { Payment } = require('../../common/database/models/Booking');

module.exports = Payment;
