'use strict';

const { AppError } = require('../../common/errors/app-error');
const { SUPPLIER_CODES } = require('../../common/config');
const { normalizeIata } = require('../suppliers/mock.helpers');
const {
  getCityByCode,
  getAirportCodesForCity,
} = require('../data/airports');

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Flight search uses metro city codes (e.g. DEL), not a single airport.
 * Backend expands each city to all airports (IGI, Hindon, Noida International, …).
 *
 * Accepts:
 * - originCityCode / destinationCityCode (preferred)
 * - origin / destination as aliases for city codes (backward compatible)
 */
function validateFlightSearchBody(body) {
  const details = [];
  const data = body || {};

  const originCityCode = normalizeIata(
    data.originCityCode || data.origin,
  );
  const destinationCityCode = normalizeIata(
    data.destinationCityCode || data.destination,
  );

  if (!/^[A-Z]{3}$/.test(originCityCode)) {
    details.push(
      'originCityCode must be a 3-letter city code (e.g. DEL). Search airports first via POST /api/v1/flights/airports/search',
    );
  } else if (!getCityByCode(originCityCode)) {
    details.push(`Unknown originCityCode: ${originCityCode}`);
  }

  if (!/^[A-Z]{3}$/.test(destinationCityCode)) {
    details.push('destinationCityCode must be a 3-letter city code (e.g. BOM)');
  } else if (!getCityByCode(destinationCityCode)) {
    details.push(`Unknown destinationCityCode: ${destinationCityCode}`);
  }

  if (
    originCityCode &&
    destinationCityCode &&
    originCityCode === destinationCityCode
  ) {
    details.push('originCityCode and destinationCityCode must be different');
  }

  if (!isIsoDate(data.departDate)) {
    details.push('departDate must be YYYY-MM-DD');
  }
  if (data.returnDate !== undefined && data.returnDate !== null && data.returnDate !== '') {
    if (!isIsoDate(data.returnDate)) {
      details.push('returnDate must be YYYY-MM-DD when provided');
    }
  }

  const adults = data.adults;
  const children = data.children ?? 0;
  const infants = data.infants ?? 0;
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
    details.push('adults must be an integer between 1 and 9');
  }
  if (!Number.isInteger(children) || children < 0 || children > 8) {
    details.push('children must be an integer between 0 and 8');
  }
  if (!Number.isInteger(infants) || infants < 0 || infants > adults) {
    details.push('infants must be an integer between 0 and adults');
  }
  if (data.cabinClass !== undefined) {
    const allowed = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
    if (!allowed.includes(String(data.cabinClass).toUpperCase())) {
      details.push(`cabinClass must be one of ${allowed.join(', ')}`);
    }
  }
  if (
    data.currency !== undefined &&
    (typeof data.currency !== 'string' || data.currency.length !== 3)
  ) {
    details.push('currency must be a 3-letter code');
  }
  if (data.tripType !== undefined) {
    const t = String(data.tripType).toUpperCase();
    if (!['ONEWAY', 'ROUNDTRIP'].includes(t)) {
      details.push('tripType must be ONEWAY or ROUNDTRIP');
    }
  }

  if (details.length > 0) {
    throw AppError.validation('Invalid flight search request', details);
  }

  const originAirports = getAirportCodesForCity(originCityCode);
  const destinationAirports = getAirportCodesForCity(destinationCityCode);

  return {
    tripType: String(data.tripType || 'ONEWAY').toUpperCase(),
    originCityCode,
    destinationCityCode,
    /** Expanded airport list for multi-airport metro search */
    originAirports,
    destinationAirports,
    /** Primary airport codes (compat for older fields in logs) */
    origin: originCityCode,
    destination: destinationCityCode,
    departDate: data.departDate,
    returnDate: data.returnDate || undefined,
    adults,
    children,
    infants,
    cabinClass: String(data.cabinClass || 'ECONOMY').toUpperCase(),
    currency: (data.currency || 'INR').toUpperCase(),
  };
}

function parseFailureHeader(header) {
  if (!header || !String(header).trim()) return [];
  return String(header)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SUPPLIER_CODES.includes(s));
}

function validateFlightLookup(body, { requireFareId = false } = {}) {
  const details = [];
  if (!body?.searchId || typeof body.searchId !== 'string') {
    details.push('searchId is required');
  }
  if (!body?.aplFlightId || typeof body.aplFlightId !== 'string') {
    details.push('aplFlightId is required');
  }

  // Prefer aplFareId; accept legacy aplOfferId as alias
  const aplFareId =
    (typeof body.aplFareId === 'string' && body.aplFareId) ||
    (typeof body.aplOfferId === 'string' && body.aplOfferId) ||
    undefined;

  if (requireFareId && !aplFareId) {
    details.push(
      'aplFareId is required (from flightFareData[].aplFareId). Legacy field aplOfferId is also accepted.',
    );
  }

  if (details.length) throw AppError.validation('Invalid request', details);

  return {
    searchId: body.searchId,
    aplFlightId: body.aplFlightId,
    aplFareId,
  };
}

function parseAddonCodes(value, field, details) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((code) => typeof code !== 'string' || !code.trim())) {
    details.push(`${field} must be an array of code strings`);
    return [];
  }
  return value.map((code) => code.trim());
}

function parseConfirmPrice(body, details, what) {
  if (
    !body.confirmPrice ||
    typeof body.confirmPrice.amount !== 'number' ||
    !Number.isFinite(body.confirmPrice.amount)
  ) {
    details.push(`confirmPrice.amount is required (fare total + ${what})`);
  }
  if (!body.confirmPrice?.currency) {
    details.push('confirmPrice.currency is required');
  }
  if (details.some((line) => String(line).startsWith('confirmPrice'))) return null;
  return {
    amount: body.confirmPrice.amount,
    currency: String(body.confirmPrice.currency).trim().toUpperCase(),
  };
}

/** Details: searchId + aplFlightId required; aplFareId optional (selects selectedFlightFareData). */
function validateDetailsBody(body) {
  return validateFlightLookup(body, { requireFareId: false });
}

/** Revalidate / checkout: both flight + fare required. */
function validateFlightFareLookup(body) {
  return validateFlightLookup(body, { requireFareId: true });
}

function validateCheckoutBody(body) {
  const base = validateFlightFareLookup(body);
  const details = [];
  if (!body.contact?.email || typeof body.contact.email !== 'string') {
    details.push('contact.email is required');
  }
  if (!body.contact?.phone || typeof body.contact.phone !== 'string') {
    details.push('contact.phone is required');
  }
  if (!Array.isArray(body.travellers) || body.travellers.length < 1) {
    details.push('travellers must be a non-empty array');
  } else {
    body.travellers.forEach((t, i) => {
      if (!t.firstName || !t.lastName) {
        details.push(`travellers[${i}].firstName and lastName are required`);
      }
      if (!t.type || !['ADULT', 'CHILD', 'INFANT'].includes(String(t.type).toUpperCase())) {
        details.push(`travellers[${i}].type must be ADULT, CHILD, or INFANT`);
      }
    });
  }
  if (details.length) throw AppError.validation('Invalid checkout request', details);

  const addOns = body.addOns || {};
  const seats = parseAddonCodes(addOns.seats, 'addOns.seats', details);
  const baggage = parseAddonCodes(addOns.baggage, 'addOns.baggage', details);
  const meals = parseAddonCodes(addOns.meals, 'addOns.meals', details);
  const confirmPrice = parseConfirmPrice(body, details, 'seat, baggage, and meal add-ons');

  let selectedFareQuote = null;
  const rawSelected = body.selectedFareQuote || body.fareQuote || null;
  if (rawSelected != null) {
    if (
      typeof rawSelected !== 'object' ||
      !Number.isFinite(Number(rawSelected.amount)) ||
      Number(rawSelected.amount) <= 0
    ) {
      details.push('selectedFareQuote.amount must be a positive number when provided');
    } else {
      selectedFareQuote = {
        amount: Number(rawSelected.amount),
        currency: String(rawSelected.currency || confirmPrice?.currency || 'INR')
          .trim()
          .toUpperCase(),
        label: rawSelected.label ? String(rawSelected.label) : undefined,
        fareType: rawSelected.fareType ? String(rawSelected.fareType) : undefined,
      };
    }
  }

  if (details.length) throw AppError.validation('Invalid checkout request', details);

  return {
    ...base,
    addOns: { seats, baggage, meals },
    confirmPrice,
    selectedFareQuote,
    contact: {
      email: body.contact.email.trim(),
      phone: String(body.contact.phone).trim(),
      countryCode: body.contact.countryCode || '+91',
    },
    travellers: body.travellers.map((t) => ({
      type: String(t.type).toUpperCase(),
      title: t.title || (String(t.type).toUpperCase() === 'ADULT' ? 'Mr' : 'Mstr'),
      firstName: t.firstName.trim(),
      lastName: t.lastName.trim(),
      dateOfBirth: t.dateOfBirth,
      gender: t.gender,
      nationality: t.nationality || 'IN',
      passportNumber: t.passportNumber,
      passportExpiry: t.passportExpiry,
    })),
  };
}

function validateBookBody(body) {
  const details = [];
  if (!body?.checkoutToken || typeof body.checkoutToken !== 'string') {
    details.push('checkoutToken is required (from checkout response)');
  }
  if (!body?.payment || typeof body.payment !== 'object') {
    details.push('payment object is required');
  } else {
    if (!body.payment.method) details.push('payment.method is required (e.g. CARD, UPI)');
  }
  const confirmPrice = parseConfirmPrice(body, details, 'the checkout total');
  if (details.length) throw AppError.validation('Invalid book request', details);

  return {
    checkoutToken: body.checkoutToken,
    confirmPrice,
    payment: {
      method: String(body.payment.method).toUpperCase(),
      cardNumber: body.payment.cardNumber,
      upiId: body.payment.upiId,
      idempotencyKey: body.payment.idempotencyKey,
      simulateBookingFailure: body.payment.simulateBookingFailure,
    },
    idempotencyKey: body.idempotencyKey,
    /** Dev/test only — never enable in production gateways. */
    simulateBookingFailure:
      body.simulateBookingFailure === true ||
      String(body.simulateBookingFailure || '').toLowerCase() === 'true',
  };
}

module.exports = {
  validateFlightSearchBody,
  parseFailureHeader,
  validateDetailsBody,
  validateFlightFareLookup,
  validateCheckoutBody,
  validateBookBody,
  /** @deprecated use validateDetailsBody / validateFlightFareLookup */
  validateOfferLookup: validateFlightFareLookup,
};
