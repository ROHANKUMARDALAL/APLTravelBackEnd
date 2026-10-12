'use strict';

function normalizeFlightNumber(num) {
  return String(num || '')
    .replace(/\s+/g, '')
    .replace(/^0+/, '')
    .toUpperCase();
}

function displayFlightNumber(airlineCode, flightNumber) {
  const code = String(airlineCode || '').trim().toUpperCase();
  let number = normalizeFlightNumber(flightNumber);
  if (!number) return '';
  if (code && number.startsWith(code)) {
    number = number.slice(code.length);
    if (number.startsWith(code)) number = number.slice(code.length);
  }
  number = number.replace(/^0+/, '') || number;
  if (!number) return code;
  return code ? `${code} ${number}` : number;
}

function segmentDisplay(segment, canonical, segmentCount) {
  const ownNumber = segment?.flightNumber || (segmentCount === 1 ? canonical?.flightNumber : '');
  const ownCode = segment?.airlineCode || segment?.marketingCarrier || (ownNumber ? canonical?.airlineCode : '');
  return ownNumber ? displayFlightNumber(ownCode || canonical?.airlineCode, ownNumber) : '';
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

module.exports = { normalizeCandidate, normalizeFlightNumber, displayFlightNumber, segmentDisplay };
