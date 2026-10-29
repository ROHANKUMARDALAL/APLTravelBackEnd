'use strict';

const { Booking, Payment } = require('../common/database/models/Booking');

const SERVICE_LABELS = {
  flight: 'Flight',
  hotel: 'Hotel',
  bus: 'Bus',
  transfer: 'Cab',
  cab: 'Cab',
  insurance: 'Insurance',
};

function normalizeServiceCode(value) {
  const code = String(value || '').trim().toLowerCase();
  if (code === 'cab') return 'transfer';
  return SERVICE_LABELS[code] ? code : '';
}

function bookingPaymentLabel(serviceCode, reversal = false) {
  const name = SERVICE_LABELS[String(serviceCode || '').trim().toLowerCase()];
  const base = reversal ? 'Booking payment reversal' : 'Booking Payment';
  return name ? `${base} (${name})` : base;
}

function paymentRefOf(row) {
  return row.paymentRef || String(row.reference || '').replace(/:reversal$/, '');
}

async function serviceCodesForWalletRows(userId, rows) {
  const found = new Map();
  const pending = [];
  for (const row of rows) {
    if (!['BOOKING_DEBIT', 'BOOKING_REVERSAL'].includes(row.type)) continue;
    const stored = normalizeServiceCode(row.serviceCode);
    if (stored) {
      found.set(String(row._id), stored);
      continue;
    }
    pending.push(row);
  }
  if (!pending.length) return found;
  const paymentRefs = [...new Set(pending.map(paymentRefOf).filter(Boolean))];
  const bookingRefs = [...new Set(pending.map((row) => row.bookingReference).filter(Boolean))];
  const payments = paymentRefs.length
    ? await Payment.find({ userId, paymentRef: { $in: paymentRefs } }).select('paymentRef bookingId').lean()
    : [];
  const bookingIds = payments.map((row) => row.bookingId).filter(Boolean);
  const or = [];
  if (bookingIds.length) or.push({ _id: { $in: bookingIds } });
  if (bookingRefs.length) or.push({ aplBookingRef: { $in: bookingRefs } });
  const bookings = or.length
    ? await Booking.find({ userId, $or: or }).select('aplBookingRef productType').lean()
    : [];
  const byId = new Map(bookings.map((row) => [String(row._id), row.productType]));
  const byRef = new Map(bookings.map((row) => [row.aplBookingRef, row.productType]));
  const byPayment = new Map(payments.map((row) => [row.paymentRef, byId.get(String(row.bookingId)) || '']));
  for (const row of pending) {
    const code = normalizeServiceCode(byPayment.get(paymentRefOf(row)) || byRef.get(row.bookingReference));
    if (code) found.set(String(row._id), code);
  }
  return found;
}

module.exports = {
  SERVICE_LABELS,
  normalizeServiceCode,
  bookingPaymentLabel,
  serviceCodesForWalletRows,
};
