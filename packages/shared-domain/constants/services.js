'use strict';

/** Canonical master service codes (lowercase; matches Service.code). */
const ServiceCode = Object.freeze({
  FLIGHT: 'flight',
  HOTEL: 'hotel',
  BUS: 'bus',
  TRANSFER: 'transfer',
});

/** ProductType on bookings / searches (uppercase). */
const ProductType = Object.freeze({
  FLIGHT: 'FLIGHT',
  HOTEL: 'HOTEL',
  BUS: 'BUS',
  TRANSFER: 'TRANSFER',
});

const SERVICE_GLOBAL_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);

function serviceCodeToProductType(code) {
  const c = String(code || '').toLowerCase();
  const map = {
    [ServiceCode.FLIGHT]: ProductType.FLIGHT,
    [ServiceCode.HOTEL]: ProductType.HOTEL,
    [ServiceCode.BUS]: ProductType.BUS,
    [ServiceCode.TRANSFER]: ProductType.TRANSFER,
  };
  return map[c] || String(code || '').toUpperCase();
}

module.exports = {
  ServiceCode,
  ProductType,
  SERVICE_GLOBAL_STATUSES,
  serviceCodeToProductType,
};
