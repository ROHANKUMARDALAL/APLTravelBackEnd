'use strict';

/**
 * APL-owned Bus location helpers.
 * B2C sends free-text city names; we normalize to APL location codes.
 * Supplier location IDs stay on supplier mappings — never the B2C canonical identity.
 */

function slugifyLocation(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function formatAplLocationId(cityName) {
  const slug = slugifyLocation(cityName);
  if (!slug) return null;
  return `APL-LOC-${slug.toUpperCase()}`;
}

function normalizeLocationInput(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    return {
      aplLocationId: formatAplLocationId(name),
      name,
      kind: 'CITY',
    };
  }
  const name = String(raw.name || raw.city || raw.label || '').trim();
  if (!name) return null;
  return {
    aplLocationId: raw.aplLocationId || formatAplLocationId(name),
    name,
    kind: String(raw.kind || 'CITY').toUpperCase(),
    stationHint: raw.station || raw.stationHint || null,
  };
}

/** Dev catalog for location search suggestions (not supplier IDs). */
const APL_BUS_LOCATIONS = [
  { name: 'New York', kind: 'CITY' },
  { name: 'Boston', kind: 'CITY' },
  { name: 'Delhi', kind: 'CITY' },
  { name: 'Mumbai', kind: 'CITY' },
  { name: 'Bangalore', kind: 'CITY' },
  { name: 'Chennai', kind: 'CITY' },
  { name: 'Hyderabad', kind: 'CITY' },
  { name: 'Pune', kind: 'CITY' },
  { name: 'Jaipur', kind: 'CITY' },
  { name: 'Ahmedabad', kind: 'CITY' },
].map((row) => ({
  ...row,
  aplLocationId: formatAplLocationId(row.name),
}));

function searchAplBusLocations(query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q || q.length < 1) {
    return APL_BUS_LOCATIONS.slice(0, 8);
  }
  return APL_BUS_LOCATIONS.filter(
    (loc) =>
      loc.name.toLowerCase().includes(q) ||
      loc.aplLocationId.toLowerCase().includes(q),
  ).slice(0, 12);
}

module.exports = {
  formatAplLocationId,
  normalizeLocationInput,
  searchAplBusLocations,
  slugifyLocation,
  APL_BUS_LOCATIONS,
};
