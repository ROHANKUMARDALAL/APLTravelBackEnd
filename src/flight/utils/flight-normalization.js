'use strict';

function normalizeFlightNumber(num) {
  return String(num || '')
    .replace(/\s+/g, '')
    .replace(/^0+/, '')
    .toUpperCase();
}

function normalizeCandidate(candidate) {
  const airlineCode = String(candidate.airlineCode || '')
    .trim()
    .toUpperCase();
  const flightNumber = normalizeFlightNumber(candidate.flightNumber);
  const firstSeg = candidate.segments?.[0] || {};

  return {
    ...candidate,
    airlineCode,
    flightNumber,
    airlineName: String(candidate.airlineName || airlineCode).trim(),
    cabinClass: String(candidate.cabinClass || 'ECONOMY').toUpperCase(),
    fingerprints: {
      identityKey: [
        airlineCode,
        flightNumber,
        firstSeg.origin,
        firstSeg.destination,
        firstSeg.departureAt,
      ].join('|'),
      airlineCode,
      flightNumber,
      departureAt: firstSeg.departureAt,
      origin: firstSeg.origin,
      destination: firstSeg.destination,
    },
  };
}

module.exports = { normalizeCandidate, normalizeFlightNumber };
