'use strict';

const { AppError } = require('../../common/errors/app-error');
const { normalizeLocationInput } = require('../services/location.service');

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * APL Bus search contract (B2C-owned, not supplier-owned):
 * - origin / destination: city name or { name, aplLocationId }
 * - travelDate: YYYY-MM-DD
 * - passengers (optional): adults default 1
 */
function validateBusSearchBody(body) {
  const details = [];
  const data = body || {};

  const origin = normalizeLocationInput(
    data.origin || data.from || data.originCity,
  );
  const destination = normalizeLocationInput(
    data.destination || data.to || data.destinationCity,
  );

  if (!origin?.name) details.push('origin (city name) is required');
  if (!destination?.name) details.push('destination (city name) is required');
  if (
    origin?.name &&
    destination?.name &&
    origin.name.toLowerCase() === destination.name.toLowerCase()
  ) {
    details.push('origin and destination must be different');
  }

  const travelDate = data.travelDate || data.date || data.departDate;
  if (!isIsoDate(travelDate)) {
    details.push('travelDate must be YYYY-MM-DD');
  }

  const adults = data.adults ?? data.passengers?.adults ?? 1;
  const children = data.children ?? data.passengers?.children ?? 0;
  if (!Number.isInteger(Number(adults)) || Number(adults) < 1 || Number(adults) > 9) {
    details.push('adults must be an integer between 1 and 9');
  }
  if (
    !Number.isInteger(Number(children)) ||
    Number(children) < 0 ||
    Number(children) > 8
  ) {
    details.push('children must be an integer between 0 and 8');
  }

  if (details.length) {
    throw AppError.validation('Invalid bus search request', details);
  }

  return {
    origin,
    destination,
    originCity: origin.name,
    destinationCity: destination.name,
    travelDate,
    adults: Number(adults),
    children: Number(children),
    currency: String(data.currency || 'INR').toUpperCase(),
  };
}

function parseFailureHeader(headerValue) {
  if (!headerValue) return [];
  return String(headerValue)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function validateBusLookupBody(body) {
  const details = [];
  if (!body?.searchId) details.push('searchId is required');
  if (!body?.aplBusId) details.push('aplBusId is required');
  if (details.length) throw AppError.validation('Invalid bus lookup', details);
  return {
    searchId: String(body.searchId),
    aplBusId: String(body.aplBusId),
    aplOfferId: body.aplOfferId ? String(body.aplOfferId) : null,
  };
}

function validateBusCheckoutBody(body) {
  const base = validateBusLookupBody(body);
  const details = [];
  if (!body.contact?.email) details.push('contact.email is required');
  if (!body.contact?.phone) details.push('contact.phone is required');
  if (!Array.isArray(body.travellers) || body.travellers.length < 1) {
    details.push('travellers must be a non-empty array');
  }
  if (!Array.isArray(body.selectedSeats) || body.selectedSeats.length < 1) {
    details.push('selectedSeats is required (at least one seat)');
  }
  if (!body.boardingPointCode) details.push('boardingPointCode is required');
  if (!body.droppingPointCode) details.push('droppingPointCode is required');

  const confirmPrice = body.confirmPrice;
  if (
    !confirmPrice ||
    typeof confirmPrice.amount !== 'number' ||
    !confirmPrice.currency
  ) {
    details.push('confirmPrice.amount and confirmPrice.currency are required');
  }

  if (details.length) {
    throw AppError.validation('Invalid bus checkout request', details);
  }

  return {
    ...base,
    aplOfferId: body.aplOfferId ? String(body.aplOfferId) : null,
    selectedSeats: body.selectedSeats.map((s) => String(s).trim()).filter(Boolean),
    boardingPointCode: String(body.boardingPointCode),
    droppingPointCode: String(body.droppingPointCode),
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
      seat: t.seat ? String(t.seat) : undefined,
    })),
  };
}

function validateBusBookBody(body) {
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
  if (details.length) throw AppError.validation('Invalid bus book request', details);
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
  validateBusSearchBody,
  parseFailureHeader,
  validateBusLookupBody,
  validateBusCheckoutBody,
  validateBusBookBody,
  validateLocationSearchBody,
};
