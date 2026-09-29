'use strict';

const NOISE_TOKENS = new Set([
  'hotel',
  'hotels',
  'the',
  'a',
  'an',
  'and',
  'of',
  'at',
  'by',
  'delhi',
  'new',
  'india',
  'limited',
  'ltd',
  'pvt',
  'private',
]);

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeName(normalizedName) {
  return normalizedName
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return undefined;
  return digits.slice(-10);
}

function normalizeAddress(address) {
  if (!address) return undefined;
  return address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(road|rd|street|st|avenue|ave|no|number|asset)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMealPlan(mealPlan) {
  if (!mealPlan) return undefined;
  const key = mealPlan.trim().toLowerCase();
  if (key === 'cp' || key === 'breakfast' || key.includes('breakfast')) {
    return 'Breakfast';
  }
  if (key === 'ep' || key === 'room only' || key.includes('room only')) {
    return 'Room Only';
  }
  if (key === 'map' || key.includes('half board')) return 'Half Board';
  if (key === 'ap' || key.includes('full board')) return 'Full Board';
  return mealPlan.trim();
}

function geoBucket(lat, lng) {
  if (lat === undefined || lng === undefined) return undefined;
  const latBucket = Math.round(lat * 1000) / 1000;
  const lngBucket = Math.round(lng * 1000) / 1000;
  return `${latBucket.toFixed(3)}:${lngBucket.toFixed(3)}`;
}

function normalizeCandidate(candidate) {
  const normalizedName = normalizeName(candidate.name);
  return {
    ...candidate,
    name: candidate.name.trim(),
    city: candidate.city.trim(),
    country: candidate.country.trim(),
    mealPlan: normalizeMealPlan(candidate.mealPlan),
    fingerprints: {
      normalizedName,
      nameTokens: tokenizeName(normalizedName),
      phoneDigits: normalizePhone(candidate.phone),
      geoBucket: geoBucket(candidate.latitude, candidate.longitude),
      addressKey: normalizeAddress(candidate.addressLine1),
    },
  };
}

module.exports = {
  normalizeCandidate,
  normalizeName,
  tokenizeName,
  normalizePhone,
  normalizeAddress,
  normalizeMealPlan,
  geoBucket,
};
