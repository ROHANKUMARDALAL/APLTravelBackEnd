'use strict';

/**
 * Normalize a raw mock/supplier transfer candidate into APL intermediate shape.
 */
function normalizeCandidate(raw, supplierCode) {
  const amount = Number(raw.fareAmount ?? raw.price?.amount ?? 0);
  const currency = String(raw.currency || raw.price?.currency || 'INR').toUpperCase();
  const vehicleCategory = String(raw.vehicleCategory || 'SEDAN').toUpperCase();

  return {
    supplier: String(supplierCode || raw.supplier || '').toUpperCase(),
    supplierServiceId: String(raw.supplierServiceId || raw.id || ''),
    supplierReference: raw.supplierReference || raw.supplierServiceId || null,
    transferType: String(raw.transferType || 'AIRPORT_TRANSFER').toUpperCase(),
    vehicleCategory,
    vehicleName: String(raw.vehicleName || vehicleCategory).trim(),
    maxPassengers: Number(raw.maxPassengers) || 3,
    maxLuggage: Number(raw.maxLuggage) || 2,
    estimatedDurationMinutes: Number(raw.estimatedDurationMinutes) || 0,
    inclusions: Array.isArray(raw.inclusions) ? raw.inclusions : [],
    pickup: raw.pickup || null,
    dropoff: raw.dropoff || null,
    pickupDateTime: raw.pickupDateTime || null,
    supplierPrice: { amount, currency },
    cancellationNote:
      raw.cancellationNote ||
      'Mock cancellation — not a real operator refund quote',
  };
}

module.exports = { normalizeCandidate };
