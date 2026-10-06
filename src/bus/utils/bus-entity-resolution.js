'use strict';

const {
  formatAplBusId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');

/**
 * Matching strategy (Phase 14A):
 * Cluster only when ALL of these match (safe merge):
 * - operator (case-insensitive)
 * - origin APL location
 * - destination APL location
 * - departure time (HH:mm)
 * - arrival time (HH:mm)
 * - travel date
 *
 * Prefer duplicate results over incorrectly combining different buses.
 */
function matchKey(candidate) {
  return [
    String(candidate.operator || '')
      .trim()
      .toLowerCase(),
    candidate.departure?.aplLocationId || '',
    candidate.arrival?.aplLocationId || '',
    candidate.departure?.time || '',
    candidate.arrival?.time || '',
    candidate.travelDate || '',
  ].join('|');
}

function resolveBuses(candidates) {
  const clusters = new Map();
  for (const candidate of candidates) {
    const key = matchKey(candidate);
    if (!clusters.has(key)) {
      const seq = stableSeqFromKey(key);
      clusters.set(key, {
        matchKey: key,
        aplBusId: formatAplBusId(seq),
        canonical: {
          operator: candidate.operator,
          busType: candidate.busType,
          durationMinutes: candidate.durationMinutes,
          amenities: candidate.amenities,
          departure: candidate.departure,
          arrival: candidate.arrival,
          travelDate: candidate.travelDate,
          cancellationNote: candidate.cancellationNote,
        },
        members: [],
      });
    }
    clusters.get(key).members.push(candidate);
  }
  return Array.from(clusters.values());
}

module.exports = { resolveBuses, matchKey };
