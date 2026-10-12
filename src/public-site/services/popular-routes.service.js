'use strict';

/**
 * Public popular-route grouping.
 * A group is returned only when the service is offered to this DSA.
 * Offered means globally active, allowed by APL, and activated by the DSA.
 */
const SUPPORTED_ROUTE_SERVICES = new Set(['flight', 'hotel', 'bus', 'transfer']);

function normalizeServiceCode(value) {
  return String(value || '').trim().toLowerCase();
}

function toPublicRoute(row) {
  return {
    id: String(row._id || row.id || ''),
    serviceCode: normalizeServiceCode(row.serviceCode),
    originCode: row.originCode,
    destinationCode: row.destinationCode,
    originName: row.originName,
    destinationName: row.destinationName,
    airlineCode: row.airlineCode,
    airlineName: row.airlineName,
    tripType: row.tripType,
    departOffsetDays: row.searchDefaults?.departOffsetDays || row.departOffsetDays || 7,
    adults: row.searchDefaults?.adults || row.adults || 1,
    guests: row.searchDefaults?.guests || row.guests || 2,
    rooms: row.searchDefaults?.rooms || row.rooms || 1,
    stayNights: row.searchDefaults?.stayNights || row.stayNights || 1,
    passengers: row.searchDefaults?.passengers || row.passengers || 1,
    pickupTime: row.searchDefaults?.pickupTime || row.pickupTime || '10:00',
    pickupKind: row.searchDefaults?.pickupKind || row.pickupKind || '',
    dropoffKind: row.searchDefaults?.dropoffKind || row.dropoffKind || '',
    displayTitle: row.displayTitle,
    description: row.description,
    imageUrl: row.imageUrl || '',
    priority: row.priority,
  };
}

function groupPublicPopularRoutes(offeredServices, rows) {
  const offered = new Set(
    (offeredServices || []).map((service) => normalizeServiceCode(service.code || service)),
  );
  const grouped = new Map();

  for (const row of rows || []) {
    const serviceCode = normalizeServiceCode(row.serviceCode);
    if (!offered.has(serviceCode) || !SUPPORTED_ROUTE_SERVICES.has(serviceCode)) continue;
    if (row.isActive === false || row.isFeatured === false) continue;
    const routes = grouped.get(serviceCode) || [];
    routes.push(toPublicRoute(row));
    grouped.set(serviceCode, routes);
  }

  return [...grouped.entries()]
    .filter(([, routes]) => routes.length > 0)
    .map(([serviceCode, routes]) => ({ serviceCode, routes }));
}

module.exports = {
  SUPPORTED_ROUTE_SERVICES,
  groupPublicPopularRoutes,
  toPublicRoute,
};
