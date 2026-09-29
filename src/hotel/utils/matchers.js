'use strict';

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const geoProximityMatcher = {
  name: 'geo_proximity',
  weight: 0.35,
  score({ left, right }) {
    if (
      left.latitude === undefined ||
      left.longitude === undefined ||
      right.latitude === undefined ||
      right.longitude === undefined
    ) {
      return { applicable: false, score: 0 };
    }
    const meters = distanceMeters(
      left.latitude,
      left.longitude,
      right.latitude,
      right.longitude,
    );
    if (meters <= 80) return { applicable: true, score: 1, reason: `${Math.round(meters)}m` };
    if (meters <= 150) return { applicable: true, score: 0.85, reason: `${Math.round(meters)}m` };
    if (meters <= 300) return { applicable: true, score: 0.55, reason: `${Math.round(meters)}m` };
    if (meters <= 800) return { applicable: true, score: 0.2, reason: `${Math.round(meters)}m` };
    return { applicable: true, score: 0, reason: `${Math.round(meters)}m` };
  },
};

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function levenshteinRatio(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

const nameSimilarityMatcher = {
  name: 'name_similarity',
  weight: 0.3,
  score({ left, right }) {
    const tokenScore = jaccard(
      left.fingerprints.nameTokens,
      right.fingerprints.nameTokens,
    );
    const editScore = levenshteinRatio(
      left.fingerprints.normalizedName,
      right.fingerprints.normalizedName,
    );
    const score = Math.max(tokenScore, editScore * 0.95);
    return {
      applicable: true,
      score,
      reason: `tokens=${tokenScore.toFixed(2)}, edit=${editScore.toFixed(2)}`,
    };
  },
};

const postalCodeMatcher = {
  name: 'postal_code',
  weight: 0.15,
  score({ left, right }) {
    const a = left.postalCode?.replace(/\s+/g, '').toUpperCase();
    const b = right.postalCode?.replace(/\s+/g, '').toUpperCase();
    if (!a || !b) return { applicable: false, score: 0 };
    return { applicable: true, score: a === b ? 1 : 0, reason: `${a} vs ${b}` };
  },
};

const phoneMatcher = {
  name: 'phone',
  weight: 0.1,
  score({ left, right }) {
    const a = left.fingerprints.phoneDigits;
    const b = right.fingerprints.phoneDigits;
    if (!a || !b) return { applicable: false, score: 0 };
    return { applicable: true, score: a === b ? 1 : 0, reason: `${a} vs ${b}` };
  },
};

const addressTokenMatcher = {
  name: 'address_tokens',
  weight: 0.1,
  score({ left, right }) {
    const a = left.fingerprints.addressKey;
    const b = right.fingerprints.addressKey;
    if (!a || !b) return { applicable: false, score: 0 };
    const tokensA = new Set(a.split(' ').filter(Boolean));
    const tokensB = new Set(b.split(' ').filter(Boolean));
    let inter = 0;
    for (const t of tokensA) if (tokensB.has(t)) inter += 1;
    const union = tokensA.size + tokensB.size - inter;
    const score = union === 0 ? 0 : inter / union;
    return { applicable: true, score, reason: `jaccard=${score.toFixed(2)}` };
  },
};

module.exports = {
  geoProximityMatcher,
  nameSimilarityMatcher,
  postalCodeMatcher,
  phoneMatcher,
  addressTokenMatcher,
};
