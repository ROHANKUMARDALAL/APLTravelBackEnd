'use strict';

const {
  formatAplRoomId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');
const { applyMarkup } = require('./pricing');

function consolidateOffers(clusters) {
  return clusters.map((cluster) => {
    const mappingsMap = new Map();
    const availableRooms = [];

    for (const member of cluster.members) {
      mappingsMap.set(`${member.supplier}:${member.supplierHotelId}`, {
        supplier: member.supplier,
        supplierHotelId: member.supplierHotelId,
      });

      const priced = applyMarkup(member.supplierPrice);
      const roomKey = [
        cluster.aplHotelId,
        member.supplier,
        member.supplierOfferId,
        member.roomName,
      ].join('|');

      availableRooms.push({
        aplRoomId: formatAplRoomId(stableSeqFromKey(roomKey)),
        roomName: member.roomName,
        bedType: member.bedType || null,
        occupancy: member.occupancy || { maxAdults: 2, maxChildren: 0 },
        mealPlan: member.mealPlan,
        cancellation: { refundable: member.refundable },
        price: priced.customer,
        supplier: member.supplier,
        supplierOfferId: member.supplierOfferId,
        supplierHotelId: member.supplierHotelId,
        supplierReference: member.supplierReference,
        supplierPrice: priced.supplier,
      });
    }

    availableRooms.sort((a, b) => a.price.amount - b.price.amount);
    const lowest = availableRooms[0];

    return {
      aplHotelId: cluster.aplHotelId,
      name: cluster.canonical.name,
      location: {
        addressLine1: cluster.canonical.addressLine1,
        city: cluster.canonical.city,
        country: cluster.canonical.country,
        countryIso2: cluster.canonical.countryIso2,
        postalCode: cluster.canonical.postalCode,
        latitude: cluster.canonical.latitude,
        longitude: cluster.canonical.longitude,
      },
      starRating: cluster.canonical.starRating,
      phone: cluster.canonical.phone,
      supplierMappings: Array.from(mappingsMap.values()),
      availableRoomCount: availableRooms.length,
      availableRooms,
      lowestPrice: {
        amount: lowest.price.amount,
        currency: lowest.price.currency,
      },
    };
  });
}

module.exports = { consolidateOffers };
