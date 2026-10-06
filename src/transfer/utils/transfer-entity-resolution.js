'use strict';

const {
  formatAplTransferId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');

/**
 * Matching strategy (Phase 14B — conservative):
 * Cluster only when ALL match:
 * - pickup aplLocationId
 * - dropoff aplLocationId
 * - vehicleCategory
 * - maxPassengers
 * - transferType
 * - pickup date (YYYY-MM-DD)
 *
 * Do NOT merge different vehicle categories/capacities merely because the route matches.
 */
function matchKey(candidate) {
  const pickupDate = String(candidate.pickupDateTime || '').slice(0, 10);
  return [
    candidate.pickup?.aplLocationId || '',
    candidate.dropoff?.aplLocationId || '',
    String(candidate.vehicleCategory || '').toUpperCase(),
    String(candidate.maxPassengers || ''),
    String(candidate.transferType || '').toUpperCase(),
    pickupDate,
  ].join('|');
}

function resolveTransfers(candidates) {
  const clusters = new Map();
  for (const candidate of candidates) {
    const key = matchKey(candidate);
    if (!clusters.has(key)) {
      const seq = stableSeqFromKey(key);
      clusters.set(key, {
        matchKey: key,
        aplTransferId: formatAplTransferId(seq),
        canonical: {
          transferType: candidate.transferType,
          vehicleCategory: candidate.vehicleCategory,
          vehicleName: candidate.vehicleName,
          maxPassengers: candidate.maxPassengers,
          maxLuggage: candidate.maxLuggage,
          estimatedDurationMinutes: candidate.estimatedDurationMinutes,
          inclusions: candidate.inclusions,
          pickup: candidate.pickup,
          dropoff: candidate.dropoff,
          pickupDateTime: candidate.pickupDateTime,
          cancellationNote: candidate.cancellationNote,
        },
        members: [],
      });
    }
    clusters.get(key).members.push(candidate);
  }
  return Array.from(clusters.values());
}

module.exports = { resolveTransfers, matchKey };
