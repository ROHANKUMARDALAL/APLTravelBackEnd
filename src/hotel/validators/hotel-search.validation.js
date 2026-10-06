'use strict';

const { AppError } = require('../../common/errors/app-error');
const { SUPPLIER_CODES } = require('../../common/config');
const { getCityByCode } = require('../data/cities');

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function readChildAges(data, children, details) {
  const hasAges = data.childAges !== undefined;
  if (children === 0) {
    if (hasAges && (!Array.isArray(data.childAges) || data.childAges.length > 0)) {
      details.push('childAges must be [] when children is 0');
      return [];
    }
    return [];
  }

  if (!Array.isArray(data.childAges)) {
    details.push(
      'childAges is required when children > 0 and must be an array of age strings, e.g. ["5","8"]',
    );
    return [];
  }
  if (data.childAges.length !== children) {
    details.push(
      `childAges length (${data.childAges.length}) must equal children (${children})`,
    );
  }

  return data.childAges.map((age, i) => {
    const text = String(age).trim();
    if (!/^\d+$/.test(text)) {
      details.push(`childAges[${i}] must be an age string such as "5"`);
      return text;
    }
    const years = Number(text);
    if (years < 0 || years > 17) {
      details.push(`childAges[${i}] must be between 0 and 17`);
    }
    return text;
  });
}

function validateHotelSearchBody(body) {
  const details = [];
  const data = body || {};

  let cityCode;
  let cityName;

  if (data.cityCode != null && String(data.cityCode).trim()) {
    cityCode = String(data.cityCode).trim();
    if (!/^\d+$/.test(cityCode)) {
      details.push(
        'cityCode must be numeric (supplier CityId). Search cities first, e.g. 130443 for New Delhi.',
      );
    } else {
      const city = getCityByCode(cityCode);
      if (!city) details.push(`Unknown cityCode: ${cityCode}. Search cities first.`);
      else cityName = city.cityName;
    }
  } else if (typeof data.city === 'string' && data.city.trim().length >= 2) {
    cityName = data.city.trim();
  } else {
    details.push(
      'cityCode is required and numeric (e.g. 130443). Find it via POST /api/v1/hotels/cities/search.',
    );
  }

  if (!isIsoDate(data.checkIn)) details.push('checkIn must be YYYY-MM-DD');
  if (!isIsoDate(data.checkOut)) details.push('checkOut must be YYYY-MM-DD');
  if (!Number.isInteger(data.rooms) || data.rooms < 1 || data.rooms > 8) {
    details.push('rooms must be an integer between 1 and 8');
  }
  if (!Number.isInteger(data.adults) || data.adults < 1 || data.adults > 20) {
    details.push('adults must be an integer between 1 and 20');
  }

  let children = 0;
  if (data.children !== undefined) {
    if (!Number.isInteger(data.children) || data.children < 0 || data.children > 20) {
      details.push('children must be an integer between 0 and 20');
    } else {
      children = data.children;
    }
  } else if (Array.isArray(data.childAges)) {
    children = data.childAges.length;
  }

  const childAges = readChildAges(data, children, details);

  if (
    data.currency !== undefined &&
    (typeof data.currency !== 'string' || data.currency.length !== 3)
  ) {
    details.push('currency must be a 3-letter code');
  }

  if (details.length > 0) {
    throw AppError.validation('Invalid search request', details);
  }

  return {
    cityCode,
    city: cityName,
    country: data.country?.trim(),
    checkIn: data.checkIn,
    checkOut: data.checkOut,
    rooms: data.rooms,
    adults: data.adults,
    children,
    childAges,
    currency: data.currency,
  };
}

function parseFailureHeader(header) {
  if (!header || !String(header).trim()) return [];
  return String(header)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SUPPLIER_CODES.includes(s));
}

function validateHotelLookup(body, { requireRoomId = false } = {}) {
  const details = [];
  if (!body?.searchId) details.push('searchId is required');
  if (!body?.aplHotelId || typeof body.aplHotelId !== 'string') {
    details.push('aplHotelId is required');
  }
  const aplRoomId =
    (typeof body.aplRoomId === 'string' && body.aplRoomId) ||
    (typeof body.aplOfferId === 'string' && body.aplOfferId) ||
    undefined;
  if (requireRoomId && !aplRoomId) {
    details.push('aplRoomId is required (from availableRooms[].aplRoomId)');
  }
  if (details.length) throw AppError.validation('Invalid request', details);
  return { searchId: body.searchId, aplHotelId: body.aplHotelId, aplRoomId };
}

function validateHotelDetailsBody(body) {
  return validateHotelLookup(body, { requireRoomId: false });
}

function validateHotelRoomLookup(body) {
  return validateHotelLookup(body, { requireRoomId: true });
}

function parseConfirmPrice(body, details) {
  if (
    !body.confirmPrice ||
    typeof body.confirmPrice.amount !== 'number' ||
    !Number.isFinite(body.confirmPrice.amount)
  ) {
    details.push(
      'confirmPrice.amount is required (base room price + selected extraServices)',
    );
  }
  if (!body.confirmPrice?.currency) {
    details.push('confirmPrice.currency is required');
  }
  if (details.some((line) => line.startsWith('confirmPrice'))) return null;
  return {
    amount: body.confirmPrice.amount,
    currency: String(body.confirmPrice.currency).trim().toUpperCase(),
  };
}

function parseCodeList(value, field, details) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((code) => typeof code !== 'string' || !code.trim())) {
    details.push(`${field} must be an array of code strings`);
    return [];
  }
  return value.map((code) => code.trim());
}
function validateHotelCheckoutBody(body) {
  const base = validateHotelRoomLookup(body);
  const details = [];
  if (!body.contact?.email) details.push('contact.email is required');
  if (!body.contact?.phone) details.push('contact.phone is required');
  if (!Array.isArray(body.guests) || body.guests.length < 1) {
    details.push('guests must be a non-empty array');
  } else {
    body.guests.forEach((g, i) => {
      if (!g.firstName || !g.lastName) {
        details.push(`guests[${i}].firstName and lastName are required`);
      }
    });
  }
  const extraServices = parseCodeList(
    body.addOns?.extraServices,
    'addOns.extraServices',
    details,
  );
  const confirmPrice = parseConfirmPrice(body, details);
  if (details.length) throw AppError.validation('Invalid checkout request', details);

  return {
    ...base,
    addOns: { extraServices },
    confirmPrice,
    contact: {
      email: body.contact.email.trim(),
      phone: String(body.contact.phone).trim(),
      countryCode: body.contact.countryCode || '+91',
    },
    guests: body.guests.map((g) => ({
      type: String(g.type || 'ADULT').toUpperCase(),
      title: g.title || 'Mr',
      firstName: g.firstName.trim(),
      lastName: g.lastName.trim(),
      email: g.email,
      phone: g.phone,
    })),
    guestCount: Math.max(1, Number(body.guestCount) || body.guests.length || 1),
  };
}

function validateHotelBookBody(body) {
  const details = [];
  if (!body?.checkoutToken) details.push('checkoutToken is required');
  if (!body?.payment?.method) details.push('payment.method is required');
  const confirmPrice = parseConfirmPrice(body, details);
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
    simulateBookingFailure:
      body.simulateBookingFailure === true ||
      String(body.simulateBookingFailure || '').toLowerCase() === 'true',
  };
}

module.exports = {
  validateHotelSearchBody,
  parseFailureHeader,
  validateHotelDetailsBody,
  validateHotelRoomLookup,
  validateHotelCheckoutBody,
  validateHotelBookBody,
};
