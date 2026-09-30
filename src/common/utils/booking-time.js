'use strict';

/**
 * Booking clock.
 * createdAt / bookedAtUtc stay a real UTC instant so lists sort newest first.
 * bookedAtLocal is the wall clock stored for Compass and the booking screen:
 * INR uses India (IST). Any other booking currency uses that currency's country.
 */

const ZONE_BY_CURRENCY = {
  INR: { timeZone: 'Asia/Kolkata', label: 'IST' },
  USD: { timeZone: 'America/New_York', label: 'ET' },
  GBP: { timeZone: 'Europe/London', label: 'UK' },
  EUR: { timeZone: 'Europe/Paris', label: 'CET' },
  AED: { timeZone: 'Asia/Dubai', label: 'GST' },
  CAD: { timeZone: 'America/Toronto', label: 'ET' },
  AUD: { timeZone: 'Australia/Sydney', label: 'AEST' },
  SGD: { timeZone: 'Asia/Singapore', label: 'SGT' },
  JPY: { timeZone: 'Asia/Tokyo', label: 'JST' },
};

function zoneForCurrency(currency) {
  const code = String(currency || 'INR').trim().toUpperCase();
  return ZONE_BY_CURRENCY[code] || ZONE_BY_CURRENCY.INR;
}

function part(parts, type) {
  return parts.find((entry) => entry.type === type)?.value || '';
}

function bookingClock(date, currency) {
  const bookedAtUtc = date instanceof Date ? date : new Date(date);
  const zone = zoneForCurrency(currency);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone.timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(bookedAtUtc);

  return {
    bookedAtUtc,
    timeZone: zone.timeZone,
    bookedAtLocal: `${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}, ${part(parts, 'hour')}:${part(parts, 'minute')}:${part(parts, 'second')} ${zone.label}`,
  };
}

function serviceFolderName(productType) {
  return String(productType || 'hotel').trim().toLowerCase();
}

module.exports = {
  ZONE_BY_CURRENCY,
  bookingClock,
  serviceFolderName,
};
