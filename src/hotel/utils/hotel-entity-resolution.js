'use strict';

const {
  formatAplHotelId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');
const {
  geoProximityMatcher,
  nameSimilarityMatcher,
  postalCodeMatcher,
  phoneMatcher,
  addressTokenMatcher,
} = require('./matchers');

const MATCH_THRESHOLD = 0.72;
const MATCHERS = [
  geoProximityMatcher,
  nameSimilarityMatcher,
  postalCodeMatcher,
  phoneMatcher,
  addressTokenMatcher,
];

function richness(r) {
  return (
    (r.addressLine1 ? 2 : 0) +
    (r.latitude !== undefined ? 2 : 0) +
    (r.phone ? 1 : 0) +
    (r.postalCode ? 1 : 0) +
    (r.starRating ? 1 : 0)
  );
}

function scorePair(a, b) {
  if (
    a.city.trim().toLowerCase() !== b.city.trim().toLowerCase() &&
    a.fingerprints.normalizedName !== b.fingerprints.normalizedName
  ) {
    const geo = geoProximityMatcher.score({ left: a, right: b });
    if (!geo.applicable || geo.score < 0.9) return 0;
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const matcher of MATCHERS) {
    const result = matcher.score({ left: a, right: b });
    if (result.applicable) {
      weighted += result.score * matcher.weight;
      totalWeight += matcher.weight;
    }
  }
  if (totalWeight === 0) return 0;
  return weighted / totalWeight;
}

function assignAplHotelId(record) {
  const key = [
    record.fingerprints.normalizedName,
    record.city.toLowerCase(),
    record.countryIso2 || record.country.toLowerCase(),
    record.postalCode || '',
    record.fingerprints.geoBucket || '',
  ].join('|');
  return formatAplHotelId(stableSeqFromKey(key));
}

/**
 * Extensible multi-signal entity resolution (not name-only).
 */
function resolveHotels(records) {
  const clusters = [];

  for (const record of records) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < clusters.length; i += 1) {
      const score = scorePair(clusters[i].canonical, record);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= MATCH_THRESHOLD) {
      clusters[bestIdx].members.push(record);
      clusters[bestIdx].matchScore = Math.max(clusters[bestIdx].matchScore, bestScore);
      if (richness(record) > richness(clusters[bestIdx].canonical)) {
        clusters[bestIdx].canonical = record;
      }
    } else {
      clusters.push({
        aplHotelId: assignAplHotelId(record),
        canonical: record,
        members: [record],
        matchScore: 1,
      });
    }
  }

  console.log(
    `Entity resolution: ${records.length} candidates → ${clusters.length} APL hotels`,
  );
  return clusters;
}

module.exports = { resolveHotels, scorePair, MATCH_THRESHOLD };
