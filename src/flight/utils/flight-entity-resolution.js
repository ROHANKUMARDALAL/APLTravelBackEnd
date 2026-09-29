'use strict';

const {
  formatAplFlightId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');

/**
 * Flight entity resolution: same marketing flight (airline + number + route + dep time)
 * from multiple suppliers → one APL flight with multiple offers.
 */
function resolveFlights(records) {
  const clusters = [];
  const byKey = new Map();

  for (const record of records) {
    const key = record.fingerprints.identityKey;
    if (byKey.has(key)) {
      const idx = byKey.get(key);
      clusters[idx].members.push(record);
    } else {
      byKey.set(key, clusters.length);
      clusters.push({
        aplFlightId: formatAplFlightId(stableSeqFromKey(key)),
        canonical: record,
        members: [record],
      });
    }
  }

  console.log(
    `Flight entity resolution: ${records.length} candidates → ${clusters.length} APL flights`,
  );
  return clusters;
}

module.exports = { resolveFlights };
