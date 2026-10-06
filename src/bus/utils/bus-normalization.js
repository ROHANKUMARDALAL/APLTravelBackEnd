'use strict';

const { formatAplLocationId } = require('../services/location.service');

/**
 * Normalize a raw mock/supplier bus candidate into APL intermediate shape.
 * Supplier IDs remain on supplier* fields only.
 */
function normalizeCandidate(raw, supplierCode) {
  const originCity = raw.originCity || raw.from?.city || '';
  const destinationCity = raw.destinationCity || raw.to?.city || '';
  const departureTime = raw.departureTime || raw.from?.time || '';
  const arrivalTime = raw.arrivalTime || raw.to?.time || '';
  const operator = String(raw.operator || '').trim();
  const busType = String(raw.busType || 'Standard').trim();

  const amount = Number(raw.fareAmount ?? raw.price?.amount ?? 0);
  const currency = String(raw.currency || raw.price?.currency || 'INR').toUpperCase();

  return {
    supplier: String(supplierCode || raw.supplier || '').toUpperCase(),
    supplierServiceId: String(raw.supplierServiceId || raw.id || ''),
    supplierReference: raw.supplierReference || raw.supplierServiceId || null,
    operator,
    busType,
    travelDate: raw.travelDate || null,
    durationMinutes: Number(raw.durationMinutes) || 0,
    amenities: Array.isArray(raw.amenities) ? raw.amenities : [],
    seatsLeft: Number.isFinite(Number(raw.seatsLeft)) ? Number(raw.seatsLeft) : 0,
    boardingPoints: Array.isArray(raw.boardingPoints) ? raw.boardingPoints : [],
    droppingPoints: Array.isArray(raw.droppingPoints) ? raw.droppingPoints : [],
    departure: {
      city: originCity,
      station: raw.fromStation || raw.from?.station || '',
      time: departureTime,
      aplLocationId:
        raw.originAplLocationId || formatAplLocationId(originCity),
    },
    arrival: {
      city: destinationCity,
      station: raw.toStation || raw.to?.station || '',
      time: arrivalTime,
      aplLocationId:
        raw.destinationAplLocationId || formatAplLocationId(destinationCity),
    },
    supplierPrice: {
      amount,
      currency,
    },
    cancellationNote:
      raw.cancellation ||
      'Mock cancellation — not a real operator refund quote',
  };
}

module.exports = { normalizeCandidate };
