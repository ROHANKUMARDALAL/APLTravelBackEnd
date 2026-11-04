'use strict';

const { executeSupplierSearch } = require('./execute');
const { storeDisplayedOffers, assertOfferOwnership } = require('./offers');
const { createPlaceholderAdapter } = require('./placeholder');

function fareToComparable(fare, flight) {
  const segments = flight?.segments || [{
    airline: flight?.airline?.code || flight?.airlineCode,
    flightNumber: flight?.flightNumber,
    origin: flight?.origin,
    destination: flight?.destination,
    departureAt: flight?.departureAt,
    arrivalAt: flight?.arrivalAt,
  }];
  return {
    supplierCode: fare.supplier,
    supplierOfferRef: fare.supplierOfferId || '',
    fareId: fare.aplFareId,
    currency: fare.price?.currency || 'INR',
    customerPayable: fare.price?.amount,
    priceComplete: fare.price?.complete !== false,
    cabin: fare.cabinClass || '',
    fareBrand: fare.fareType || '',
    refundable: Boolean(fare.refundable),
    baggage: fare.baggage || {},
    conditions: fare.conditions || '',
    segments,
  };
}

/**
 * Collapse only comparable displayed fares. Existing fare families stay separate
 * because baggage and refundability differ. Feature-flag callers only.
 */
async function applyGatewayFlightPresentation({ dsaId, searchId, flights }) {
  if (!Array.isArray(flights)) return flights;
  const next = [];
  for (const flight of flights) {
    const fares = Array.isArray(flight.flightFareData) ? flight.flightFareData : [];
    const comparable = fares.map((fare) => fareToComparable(fare, flight));
    const { selectLowestFlights } = require('./aggregate');
    const grouped = selectLowestFlights(comparable);
    const winners = new Set(grouped.displayed.map((row) => row.fareId));
    const kept = fares.filter((fare) => winners.has(fare.aplFareId));
    const stored = await storeDisplayedOffers({
      dsaId,
      searchId,
      serviceCode: 'flight',
      offers: grouped.displayed,
    });
    const byFare = new Map(stored.map((row) => [row.fareId, row.offerRef]));
    next.push({
      ...flight,
      flightFareData: kept.map((fare) => ({
        ...fare,
        gatewayOfferRef: byFare.get(fare.aplFareId) || fare.gatewayOfferRef,
      })),
    });
  }
  return next;
}

async function applyGatewayHotelPresentation({ dsaId, searchId, hotels }) {
  if (!Array.isArray(hotels)) return hotels;
  const { selectLowestHotels } = require('./aggregate');
  const next = [];
  for (const hotel of hotels) {
    const rooms = (hotel.availableRooms || []).map((room) => ({
      supplierCode: room.supplier,
      supplierOfferRef: room.supplierOfferId || '',
      fareId: room.aplRoomId,
      propertyId: hotel.aplHotelId,
      roomCategory: room.roomName || '',
      mealPlan: room.mealPlan || '',
      refundable: room.cancellation?.refundable === true,
      cancellation: room.cancellation?.summary || '',
      currency: room.price?.currency || 'INR',
      customerPayable: room.price?.amount,
      priceComplete: Number.isFinite(Number(room.price?.amount)) && room.supplierPrice != null,
    }));
    const grouped = selectLowestHotels(rooms);
    const winners = new Set(grouped.displayed.map((row) => row.fareId));
    const stored = await storeDisplayedOffers({
      dsaId,
      searchId,
      serviceCode: 'hotel',
      offers: grouped.displayed,
    });
    const byFare = new Map(stored.map((row) => [row.fareId, row.offerRef]));
    next.push({
      ...hotel,
      availableRooms: (hotel.availableRooms || [])
        .filter((room) => winners.has(room.aplRoomId))
        .map((room) => ({
          ...room,
          gatewayOfferRef: byFare.get(room.aplRoomId) || room.gatewayOfferRef,
        })),
    });
  }
  return next;
}

module.exports = {
  executeSupplierSearch,
  applyGatewayFlightPresentation,
  applyGatewayHotelPresentation,
  assertOfferOwnership,
  createPlaceholderAdapter,
};
