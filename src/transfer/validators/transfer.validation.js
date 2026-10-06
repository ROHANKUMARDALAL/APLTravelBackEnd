'use strict';

const { AppError } = require('../../common/errors/app-error');
const {
  normalizeTransferPoint,
  deriveTransferType,
} = require('../services/location.service');

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function isIsoDateTime(value) {
  if (typeof value !== 'string') return false;
  // Accept YYYY-MM-DDTHH:mm or full ISO
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * APL Transfer search contract (B2C-owned):
 * - pickup / dropoff: free-text or { name, kind, code? }
 * - pickupDateTime OR pickupDate + pickupTime
 * - passengers (1–8)
 * - currency
 */
function validateTransferSearchBody(body) {
  const details = [];
  const data = body || {};

  const pickup = normalizeTransferPoint(
    data.pickup || data.from || data.origin,
    data.pickupKind || 'AIRPORT',
  );
  const dropoff = normalizeTransferPoint(
    data.dropoff || data.dropOff || data.to || data.destination,
    data.dropoffKind || data.dropOffKind || 'HOTEL',
  );

  if (!pickup?.name) details.push('pickup is required');
  if (!dropoff?.name) details.push('dropoff is required');
  if (
    pickup?.aplLocationId &&
    dropoff?.aplLocationId &&
    pickup.aplLocationId === dropoff.aplLocationId
  ) {
    details.push('pickup and dropoff must be different');
  }

  let pickupDateTime = data.pickupDateTime || data.departAt || null;
  if (!pickupDateTime) {
    const date = data.pickupDate || data.date || data.travelDate;
    const time = data.pickupTime || data.time || '10:00';
    if (isIsoDate(date) && /^\d{2}:\d{2}$/.test(String(time))) {
      pickupDateTime = `${date}T${time}`;
    }
  }
  if (!isIsoDateTime(pickupDateTime)) {
    details.push('pickupDateTime must be YYYY-MM-DDTHH:mm (or pickupDate+pickupTime)');
  }

  const passengers = Number(data.passengers ?? data.adults ?? 1);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 8) {
    details.push('passengers must be an integer between 1 and 8');
  }

  if (details.length) {
    throw AppError.validation('Invalid transfer search request', details);
  }

  const transferType =
    data.transferType || deriveTransferType(pickup, dropoff);

  return {
    pickup,
    dropoff,
    pickupDateTime: String(pickupDateTime).slice(0, 16),
    passengers,
    currency: String(data.currency || 'INR').toUpperCase(),
    transferType: String(transferType).toUpperCase(),
    // Optional future fields (not required for mock booking)
    flightNumber: data.flightNumber ? String(data.flightNumber).trim() : null,
    pickupInstructions: data.pickupInstructions
      ? String(data.pickupInstructions).trim().slice(0, 500)
      : null,
  };
}

function parseFailureHeader(headerValue) {
  if (!headerValue) return [];
  return String(headerValue)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function validateTransferLookupBody(body) {
  const details = [];
  if (!body?.searchId) details.push('searchId is required');
  if (!body?.aplTransferId) details.push('aplTransferId is required');
  if (details.length) throw AppError.validation('Invalid transfer lookup', details);
  return {
    searchId: String(body.searchId),
    aplTransferId: String(body.aplTransferId),
    aplOfferId: body.aplOfferId ? String(body.aplOfferId) : null,
  };
}

function validateTransferCheckoutBody(body) {
  const base = validateTransferLookupBody(body);
  const details = [];
  if (!body.contact?.email) details.push('contact.email is required');
  if (!body.contact?.phone) details.push('contact.phone is required');
  if (!Array.isArray(body.travellers) || body.travellers.length < 1) {
    details.push('travellers must be a non-empty array');
  }
  const confirmPrice = body.confirmPrice;
  if (
    !confirmPrice ||
    typeof confirmPrice.amount !== 'number' ||
    !confirmPrice.currency
  ) {
    details.push('confirmPrice.amount and confirmPrice.currency are required');
  }
  if (details.length) {
    throw AppError.validation('Invalid transfer checkout request', details);
  }

  return {
    ...base,
    aplOfferId: body.aplOfferId ? String(body.aplOfferId) : null,
    confirmPrice: {
      amount: Number(confirmPrice.amount),
      currency: String(confirmPrice.currency).toUpperCase(),
    },
    contact: {
      email: String(body.contact.email).trim(),
      phone: String(body.contact.phone).trim(),
      countryCode: body.contact.countryCode || '+91',
    },
    travellers: body.travellers.map((t) => ({
      type: String(t.type || 'ADULT').toUpperCase(),
      title: t.title || 'Mr',
      firstName: String(t.firstName || '').trim(),
      lastName: String(t.lastName || '').trim(),
      age: t.age != null ? Number(t.age) : undefined,
    })),
    // Optional supplier-oriented fields for future adapters
    flightNumber: body.flightNumber ? String(body.flightNumber).trim() : null,
    pickupInstructions: body.pickupInstructions
      ? String(body.pickupInstructions).trim().slice(0, 500)
      : null,
  };
}

function validateTransferBookBody(body) {
  const details = [];
  if (!body?.checkoutToken) details.push('checkoutToken is required');
  if (!body?.payment?.method) details.push('payment.method is required');
  const confirmPrice = body.confirmPrice;
  if (
    !confirmPrice ||
    typeof confirmPrice.amount !== 'number' ||
    !confirmPrice.currency
  ) {
    details.push('confirmPrice is required');
  }
  if (details.length) throw AppError.validation('Invalid transfer book request', details);
  return {
    checkoutToken: body.checkoutToken,
    confirmPrice: {
      amount: Number(confirmPrice.amount),
      currency: String(confirmPrice.currency).toUpperCase(),
    },
    payment: {
      method: String(body.payment.method).toUpperCase(),
      cardNumber: body.payment.cardNumber,
      upiId: body.payment.upiId,
      idempotencyKey: body.payment.idempotencyKey,
    },
    idempotencyKey: body.idempotencyKey,
    simulateBookingFailure:
      body.simulateBookingFailure === true ||
      String(body.simulateBookingFailure || '').toLowerCase() === 'true',
  };
}

function validateLocationSearchBody(body) {
  return { query: String(body?.query || body?.q || '').trim() };
}

module.exports = {
  validateTransferSearchBody,
  parseFailureHeader,
  validateTransferLookupBody,
  validateTransferCheckoutBody,
  validateTransferBookBody,
  validateLocationSearchBody,
};
