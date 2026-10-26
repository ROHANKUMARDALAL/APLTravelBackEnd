'use strict';

/**
 * Shared mock flight operations.
 * A live adapter replaces these methods through the flight registry.
 * Prices and seat maps are deterministic. They do not change per request.
 */

function money(amount, currency = 'INR') {
  return { amount, currency };
}

function fareRulesFor(offer) {
  const refundable = Boolean(offer?.refundable);
  return {
    refundable,
    cancellation: refundable
      ? 'Cancellation is allowed before departure. The mock airline retains a fee of INR 1500 plus supplier charges. This is not a promise of a free refund.'
      : 'This fare is non-refundable in the mock contract. Taxes may be reviewed only after the supplier accepts a cancellation request.',
    change: refundable
      ? 'Date change is allowed before departure subject to a mock fee of INR 1000 and any fare difference.'
      : 'Date change is not included on this fare. A new ticket is required.',
    noShow: 'A no-show forfeits the mock ticket value. The seat is released.',
    baggage: offer?.baggage || { cabinKg: 7, checkinKg: refundable ? 20 : 15 },
  };
}

function segmentKey(segment, index) {
  const origin = segment?.origin || 'ORG';
  const destination = segment?.destination || 'DST';
  return `${origin}-${destination}-${index}`;
}

function buildSsrInventory(offer) {
  const currency = offer?.supplierPrice?.currency || offer?.price?.currency || 'INR';
  const segments = Array.isArray(offer?.segments) && offer.segments.length
    ? offer.segments
    : [
        {
          origin: offer?.departure?.airport || offer?.origin || 'DEL',
          destination: offer?.arrival?.airport || offer?.destination || 'BOM',
        },
      ];
  return {
    testBooking: true,
    currency,
    segments: segments.map((segment, index) => ({
      segmentKey: segment.segmentKey || segmentKey(segment, index),
      origin: segment.origin,
      destination: segment.destination,
      departureAt: segment.departureAt || null,
      arrivalAt: segment.arrivalAt || null,
      seats: [
        { code: '12A', label: 'Seat 12A', status: 'AVAILABLE', price: money(450, currency) },
        { code: '12B', label: 'Seat 12B', status: 'OCCUPIED', price: money(450, currency) },
        { code: '12C', label: 'Seat 12C', status: 'AVAILABLE', price: money(450, currency) },
        { code: '14F', label: 'Seat 14F', status: 'AVAILABLE', price: money(650, currency) },
      ],
      meals: [
        { code: 'VGML', label: 'Veg meal', price: money(350, currency) },
        { code: 'NVML', label: 'Non-veg meal', price: money(400, currency) },
      ],
      baggage: [
        { code: 'BG15', label: 'Extra 15 kg', price: money(1200, currency) },
        { code: 'BG30', label: 'Extra 30 kg', price: money(2200, currency) },
      ],
    })),
    fareRules: fareRulesFor(offer),
  };
}

function quoteAmount(offer) {
  const amount = Number(offer?.supplierPrice?.amount ?? offer?.price?.amount);
  const currency = offer?.supplierPrice?.currency || offer?.price?.currency || 'INR';
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
  };
}

const mockFlightOperations = {
  async fareQuote(offer, options = {}) {
    const previousPrice = quoteAmount(offer);
    const changed = options.simulatePriceChange === true;
    const nextAmount = changed ? previousPrice.amount + 250 : previousPrice.amount;
    const expired = options.expired === true;
    return {
      status: expired ? 'EXPIRED' : changed ? 'PRICE_CHANGED' : 'AVAILABLE',
      priceChanged: changed && !expired,
      previousPrice,
      price: money(nextAmount, previousPrice.currency),
      quoteId: `QTE-${offer?.supplierOfferId || offer?.aplFareId || 'MOCK'}`,
      expiresAt: expired
        ? new Date(Date.now() - 60 * 1000).toISOString()
        : new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      refundable: Boolean(offer?.refundable),
      seatsLeft: offer?.seatsLeft ?? null,
      fareRules: fareRulesFor(offer),
      baggage: offer?.baggage || fareRulesFor(offer).baggage,
      testBooking: true,
    };
  },

  async getSsr(offer) {
    return {
      status: 'SUCCESS',
      ...buildSsrInventory(offer),
    };
  },

  async blockFlight(offer, options = {}) {
    if (options.simulateFailure) {
      return {
        status: 'FAILED',
        errorCode: 'MOCK_SUPPLIER_BLOCK_FAILED',
        errorMessage: 'Simulated supplier block failure',
        holdSupported: false,
        holdStatus: 'NOT_HELD',
        testBooking: true,
      };
    }
    const seed = String(offer?.supplierOfferId || offer?.aplFareId || 'MOCK').replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
    return {
      status: 'SUCCESS',
      supplierBlockRef: `BLK-${seed || 'MOCK'}`,
      availability: 'AVAILABLE',
      holdSupported: false,
      holdStatus: 'NOT_HELD',
      quoteId: `QTE-${offer?.supplierOfferId || offer?.aplFareId || 'MOCK'}`,
      testBooking: true,
    };
  },

  async bookFlight(offer, options = {}) {
    if (options.simulateFailure) {
      return {
        status: 'FAILED',
        errorCode: 'MOCK_SUPPLIER_BOOK_FAILED',
        errorMessage: 'Simulated supplier booking failure',
        testBooking: true,
      };
    }
    const seed = String(offer?.supplierOfferId || offer?.aplFareId || offer?.aplFlightId || 'MOCK');
    const compact = seed.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() || 'MOCK01';
    const pnr = `PNR${compact}`;
    return {
      status: 'SUCCESS',
      pnr,
      supplierBookingRef: pnr,
      supplierBookingStatus: 'CONFIRMED',
      testBooking: true,
      notice: 'TEST / MOCK BOOKING. This is not a valid airline ticket.',
    };
  },

  async retrieveBooking(query = {}) {
    return {
      status: 'SUCCESS',
      pnr: query.pnr || null,
      supplierBookingStatus: 'CONFIRMED',
      testBooking: true,
    };
  },

  async cancelBooking(query = {}) {
    return {
      status: 'CANCELLED',
      pnr: query.pnr || null,
      supplierBookingStatus: 'CANCELLED',
      testBooking: true,
    };
  },
};

module.exports = {
  mockFlightOperations,
  buildSsrInventory,
  fareRulesFor,
  segmentKey,
};
