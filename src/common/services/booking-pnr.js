'use strict';

const crypto = require('crypto');

const PREFIX = {
  FLIGHT: 'TEST-FLT',
  HOTEL: 'TEST-HTL',
  BUS: 'TEST-BUS',
  TRANSFER: 'TEST-CAB',
};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeRef(value) {
  return String(value || '').trim().toUpperCase();
}

function suffix(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[bytes[index] % ALPHABET.length];
  }
  return out;
}

function generateTestPnr(productType) {
  const prefix = PREFIX[String(productType || '').toUpperCase()];
  if (!prefix) return null;
  return `${prefix}-${suffix(6)}`;
}

function isTestPnr(value) {
  return /^TEST-(FLT|HTL|BUS|CAB)-[A-Z0-9]{6}$/.test(normalizeRef(value));
}

async function assignConfirmationPnr(Booking, payload, options = {}) {
  const product = String(payload?.productType || '').toUpperCase();
  if (!payload || payload.status !== 'CONFIRMED' || !PREFIX[product] || payload.pnr) return payload;
  const supplier = normalizeRef(options.supplierReference);
  if (options.mock === false && supplier && !isTestPnr(supplier)) {
    payload.pnr = supplier;
    return payload;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateTestPnr(product);
    const taken = await Booking.findOne({ pnr: candidate }).select('_id').lean();
    if (!taken) {
      payload.pnr = candidate;
      payload.confirmationNotice = 'TEST / MOCK — Not a real reservation';
      return payload;
    }
  }
  const error = new Error('Could not allocate a unique TEST PNR');
  error.code = 'PNR_EXHAUSTED';
  throw error;
}

function referenceFilter(raw) {
  const ref = normalizeRef(raw);
  if (!/^[A-Z0-9-]{6,48}$/.test(ref)) return null;
  return {
    $or: [
      { pnr: ref },
      { aplBookingRef: ref },
      { 'items.supplierBookingRef': ref },
    ],
  };
}

module.exports = {
  assignConfirmationPnr,
  generateTestPnr,
  isTestPnr,
  normalizeRef,
  referenceFilter,
};
