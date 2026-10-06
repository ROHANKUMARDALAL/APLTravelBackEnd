'use strict';

const {
  formatAplTransferOfferId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');
const { calculatePrice } = require('../../pricing/services/pricing-engine.service');

function consolidateTransferOffers(clusters, pricingContext = null) {
  return clusters.map((cluster) => {
    const offers = [];
    const supplierMappings = [];

    for (const member of cluster.members) {
      const priced = calculatePrice({
        supplierPrice: member.supplierPrice,
        supplierCode: member.supplier,
        context: pricingContext || {
          rules: [],
          serviceCode: 'transfer',
          dsaId: null,
          at: new Date(),
          pricingVersion: '12.0',
        },
        includeInternal: true,
      });

      const offerKey = [
        cluster.aplTransferId,
        member.supplier,
        member.supplierServiceId,
      ].join('|');

      offers.push({
        aplOfferId: formatAplTransferOfferId(stableSeqFromKey(offerKey)),
        supplier: member.supplier,
        supplierServiceId: member.supplierServiceId,
        supplierReference: member.supplierReference,
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

    return {
      aplTransferId: cluster.aplTransferId,
      transferType: cluster.canonical.transferType,
      vehicleCategory: cluster.canonical.vehicleCategory,
      vehicleName: cluster.canonical.vehicleName,
      maxPassengers: cluster.canonical.maxPassengers,
      maxLuggage: cluster.canonical.maxLuggage,
      estimatedDurationMinutes: cluster.canonical.estimatedDurationMinutes,
      inclusions: cluster.canonical.inclusions,
      pickup: cluster.canonical.pickup,
      dropoff: cluster.canonical.dropoff,
      pickupDateTime: cluster.canonical.pickupDateTime,
      cancellationNote: cluster.canonical.cancellationNote,
      supplierMappings,
      offers,
      lowestPrice: cheapest
        ? { amount: cheapest.price.amount, currency: cheapest.price.currency }
        : null,
      primaryOffer: cheapest || null,
    };
  });
}

function sanitizeTransferSearchForPublic(result) {
  if (!result) return result;
  const transfers = (result.transfers || []).map((row) => ({
    ...row,
    offers: (row.offers || []).map((offer) => {
      const { commercialSnapshot, supplierPrice, ...safe } = offer;
      return safe;
    }),
    primaryOffer: row.primaryOffer
      ? (() => {
          const { commercialSnapshot, supplierPrice, ...safe } = row.primaryOffer;
          return safe;
        })()
      : null,
  }));
  return { ...result, transfers };
}

module.exports = {
  consolidateTransferOffers,
  sanitizeTransferSearchForPublic,
};
