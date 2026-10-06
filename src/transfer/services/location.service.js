'use strict';

/**
 * APL-owned Transfer location helpers.
 * Kinds: AIRPORT | HOTEL | ADDRESS | CITY
 * Never expose supplier location IDs as B2C canonical identity.
 */

function slugifyLocation(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function formatAplLocationId(name, kind = 'CITY') {
  const slug = slugifyLocation(name);
  if (!slug) return null;
  const prefix =
    String(kind || 'CITY').toUpperCase() === 'AIRPORT' ? 'APL-APT' : 'APL-LOC';
  return `${prefix}-${slug.toUpperCase()}`;
}

const KINDS = new Set(['AIRPORT', 'HOTEL', 'ADDRESS', 'CITY']);

function normalizeTransferPoint(raw, fallbackKind = 'CITY') {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    const kind = String(fallbackKind || 'CITY').toUpperCase();
    return {
      aplLocationId: formatAplLocationId(name, kind),
      name,
      kind: KINDS.has(kind) ? kind : 'CITY',
      code: null,
      addressLine: null,
    };
  }
  const name = String(
    raw.name || raw.label || raw.city || raw.airport || raw.hotel || '',
  ).trim();
  if (!name) return null;
  const kind = String(raw.kind || fallbackKind || 'CITY').toUpperCase();
  const safeKind = KINDS.has(kind) ? kind : 'CITY';
  return {
    aplLocationId:
      raw.aplLocationId || formatAplLocationId(name, safeKind),
    name,
    kind: safeKind,
    code: raw.code ? String(raw.code).toUpperCase() : null,
    addressLine: raw.addressLine || raw.address || null,
  };
}

function deriveTransferType(pickup, dropoff) {
  const kinds = [pickup?.kind, dropoff?.kind].filter(Boolean);
  if (kinds.includes('AIRPORT')) return 'AIRPORT_TRANSFER';
  return 'CITY_TRANSFER';
}

const APL_TRANSFER_LOCATIONS = [
  { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
  { name: 'Mumbai Airport (BOM)', kind: 'AIRPORT', code: 'BOM' },
  { name: 'Bangalore Airport (BLR)', kind: 'AIRPORT', code: 'BLR' },
  { name: 'Chennai Airport (MAA)', kind: 'AIRPORT', code: 'MAA' },
  { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
  { name: 'Taj Mahal Palace Mumbai', kind: 'HOTEL' },
  { name: 'ITC Gardenia Bangalore', kind: 'HOTEL' },
  { name: 'Connaught Place, Delhi', kind: 'CITY' },
  { name: 'Bandra West, Mumbai', kind: 'CITY' },
  { name: 'Indiranagar, Bangalore', kind: 'CITY' },
].map((row) => ({
  ...row,
  aplLocationId: formatAplLocationId(row.name, row.kind),
}));

function searchAplTransferLocations(query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return APL_TRANSFER_LOCATIONS.slice(0, 8);
  return APL_TRANSFER_LOCATIONS.filter(
    (loc) =>
      loc.name.toLowerCase().includes(q) ||
      (loc.code && loc.code.toLowerCase().includes(q)) ||
      loc.aplLocationId.toLowerCase().includes(q),
  ).slice(0, 12);
}

module.exports = {
  formatAplLocationId,
  normalizeTransferPoint,
  deriveTransferType,
  searchAplTransferLocations,
  slugifyLocation,
  APL_TRANSFER_LOCATIONS,
};
