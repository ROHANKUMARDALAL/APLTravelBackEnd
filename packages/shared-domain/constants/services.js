'use strict';

/** Canonical master service codes (lowercase; matches Service.code). */
const ServiceCode = Object.freeze({
  FLIGHT: 'flight',
  HOTEL: 'hotel',
  BUS: 'bus',
  VISA: 'visa',
  RECHARGE: 'recharge',
  TRANSFER: 'transfer',
  HOLIDAY: 'holiday',
  INSURANCE: 'insurance',
});

/** ProductType on bookings / searches (uppercase). */
const ProductType = Object.freeze({
  FLIGHT: 'FLIGHT',
  HOTEL: 'HOTEL',
  BUS: 'BUS',
  VISA: 'VISA',
  RECHARGE: 'RECHARGE',
  TRANSFER: 'TRANSFER',
  HOLIDAY: 'HOLIDAY',
  INSURANCE: 'INSURANCE',
});

const SERVICE_GLOBAL_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);

const SERVICE_MODES = Object.freeze(['API_BOOKING', 'ENQUIRY', 'CONFIGURABLE']);

/**
 * Stored aliases that must display and route as the canonical code.
 * Documents are not renamed, so existing DsaService rows keep their serviceId.
 */
const SERVICE_ALIASES = Object.freeze({
  cab: ServiceCode.TRANSFER,
  taxi: ServiceCode.TRANSFER,
  transfers: ServiceCode.TRANSFER,
  holidays: ServiceCode.HOLIDAY,
  holidaypackage: ServiceCode.HOLIDAY,
  insiurance: ServiceCode.INSURANCE,
});

const CANONICAL_SERVICE_CODES = Object.freeze(Object.values(ServiceCode));

const SERVICE_LABELS = Object.freeze({
  [ServiceCode.FLIGHT]: 'Flight',
  [ServiceCode.HOTEL]: 'Hotel',
  [ServiceCode.BUS]: 'Bus',
  [ServiceCode.VISA]: 'Visa',
  [ServiceCode.RECHARGE]: 'Recharge',
  [ServiceCode.TRANSFER]: 'Transfer (Cab)',
  [ServiceCode.HOLIDAY]: 'Holidays',
  [ServiceCode.INSURANCE]: 'Insurance',
});

const ENQUIRY_STATUSES = Object.freeze([
  'NEW',
  'CONTACTED',
  'IN_PROGRESS',
  'QUOTED',
  'CONFIRMED',
  'CLOSED',
  'CANCELLED',
]);

const HOLIDAY_PACKAGE_STATUSES = Object.freeze([
  'DRAFT',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
]);

const DOMESTIC_ID_TYPES = Object.freeze([
  'AADHAAR',
  'PAN',
  'DRIVING_LICENCE',
  'VOTER_ID',
  'PASSPORT',
]);

function canonicalServiceCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return SERVICE_ALIASES[normalized] || normalized;
}

function isServiceAlias(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return Boolean(SERVICE_ALIASES[normalized]);
}

function isCanonicalServiceCode(code) {
  return CANONICAL_SERVICE_CODES.includes(canonicalServiceCode(code));
}

function serviceModeForCode(code, explicit) {
  const mode = String(explicit || '').trim().toUpperCase();
  if (SERVICE_MODES.includes(mode)) return mode;
  const canonical = canonicalServiceCode(code);
  if (canonical === ServiceCode.VISA || canonical === ServiceCode.HOLIDAY || canonical === ServiceCode.INSURANCE) {
    return 'ENQUIRY';
  }
  if (canonical === ServiceCode.RECHARGE) return 'CONFIGURABLE';
  return 'API_BOOKING';
}

function publicServiceLabel(code, storedName) {
  const canonical = canonicalServiceCode(code);
  if (canonical === ServiceCode.TRANSFER || canonical === ServiceCode.HOLIDAY) {
    return SERVICE_LABELS[canonical];
  }
  return String(storedName || SERVICE_LABELS[canonical] || canonical).trim();
}

function serviceCodeToProductType(code) {
  const canonical = canonicalServiceCode(code);
  const map = {
    [ServiceCode.FLIGHT]: ProductType.FLIGHT,
    [ServiceCode.HOTEL]: ProductType.HOTEL,
    [ServiceCode.BUS]: ProductType.BUS,
    [ServiceCode.VISA]: ProductType.VISA,
    [ServiceCode.RECHARGE]: ProductType.RECHARGE,
    [ServiceCode.TRANSFER]: ProductType.TRANSFER,
    [ServiceCode.HOLIDAY]: ProductType.HOLIDAY,
    [ServiceCode.INSURANCE]: ProductType.INSURANCE,
  };
  return map[canonical] || String(code || '').toUpperCase();
}

module.exports = {
  ServiceCode,
  ProductType,
  SERVICE_GLOBAL_STATUSES,
  SERVICE_MODES,
  SERVICE_ALIASES,
  CANONICAL_SERVICE_CODES,
  SERVICE_LABELS,
  ENQUIRY_STATUSES,
  HOLIDAY_PACKAGE_STATUSES,
  DOMESTIC_ID_TYPES,
  canonicalServiceCode,
  isServiceAlias,
  isCanonicalServiceCode,
  serviceModeForCode,
  publicServiceLabel,
  serviceCodeToProductType,
};
