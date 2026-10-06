'use strict';

const {
  formatAplBusOfferId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');
const { calculatePrice } = require('../../pricing/services/pricing-engine.service');

function hourBucket(hhmm) {
  const hour = Number(String(hhmm || '').slice(0, 2));
  if (Number.isNaN(hour)) return 'morning';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'midday';
  if (hour >= 15 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function consolidateBusOffers(clusters, pricingContext = null) {
  return clusters.map((cluster) => {
    const offers = [];
    const supplierMappings = [];

    for (const member of cluster.members) {
      const priced = calculatePrice({
        supplierPrice: member.supplierPrice,
        supplierCode: member.supplier,
        context: pricingContext || {
          rules: [],
          serviceCode: 'bus',
          dsaId: null,
          at: new Date(),
          pricingVersion: '12.0',
        },
        includeInternal: true,
      });

      const offerKey = [
        cluster.aplBusId,
        member.supplier,
        member.supplierServiceId,
      ].join('|');

      offers.push({
        aplOfferId: formatAplBusOfferId(stableSeqFromKey(offerKey)),
        supplier: member.supplier,
        supplierServiceId: member.supplierServiceId,
        supplierReference: member.supplierReference,
        seatsLeft: member.seatsLeft,
        boardingPoints: member.boardingPoints,
        droppingPoints: member.droppingPoints,
        price: priced.customerPrice,
        supplierPrice: priced.supplierPrice,
        commercialSnapshot: priced.commercialSnapshot,
      });

      supplierMappings.push({
        supplier: member.supplier,
        supplierServiceId: member.supplierServiceId,
      });
    }

    offers.sort((a, b) => a.price.amount - b.price.amount);
    const cheapest = offers[0];
    const seatsLeft = Math.max(...offers.map((o) => o.seatsLeft || 0), 0);

    return {
      aplBusId: cluster.aplBusId,
      operator: cluster.canonical.operator,
      busType: cluster.canonical.busType,
      travelDate: cluster.canonical.travelDate,
      durationMinutes: cluster.canonical.durationMinutes,
      amenities: cluster.canonical.amenities,
      departure: cluster.canonical.departure,
      arrival: cluster.canonical.arrival,
      cancellationNote: cluster.canonical.cancellationNote,
      seatsLeft,
      departBucket: hourBucket(cluster.canonical.departure?.time),
      arriveBucket: hourBucket(cluster.canonical.arrival?.time),
      supplierMappings,
      offers,
      lowestPrice: cheapest
        ? { amount: cheapest.price.amount, currency: cheapest.price.currency }
        : null,
      // Primary offer for simple B2C select (cheapest supplier offer).
      primaryOffer: cheapest || null,
    };
  });
}

/**
 * Strip internal commercial margins for public B2C responses.
 */
function sanitizeBusSearchForPublic(result) {
  if (!result) return result;
  const buses = (result.buses || []).map((bus) => ({
    ...bus,
    offers: (bus.offers || []).map((offer) => {
      const { commercialSnapshot, supplierPrice, ...safe } = offer;
      return {
        ...safe,
        // Keep supplier code only as opaque reference for debugging — not required for select.
        supplier: offer.supplier,
      };
    }),
    primaryOffer: bus.primaryOffer
      ? (() => {
          const { commercialSnapshot, supplierPrice, ...safe } = bus.primaryOffer;
          return safe;
        })()
      : null,
  }));
  return { ...result, buses };
}

module.exports = {
  consolidateBusOffers,
  sanitizeBusSearchForPublic,
};
