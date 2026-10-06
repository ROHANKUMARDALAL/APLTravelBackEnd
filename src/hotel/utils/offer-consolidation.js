'use strict';

const {
  formatAplRoomId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');
const { calculatePrice } = require('../../pricing/services/pricing-engine.service');

function consolidateOffers(clusters, pricingContext = null) {
  return clusters.map((cluster) => {
    const mappingsMap = new Map();
    const availableRooms = [];

    for (const member of cluster.members) {
      mappingsMap.set(`${member.supplier}:${member.supplierHotelId}`, {
        supplier: member.supplier,
        supplierHotelId: member.supplierHotelId,
      });

      const priced = calculatePrice({
        supplierPrice: member.supplierPrice,
        supplierCode: member.supplier,
        context: pricingContext || {
          rules: [],
          serviceCode: 'hotel',
          dsaId: null,
          at: new Date(),
          pricingVersion: '12.0',
        },
        includeInternal: true,
      });

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
        price: priced.customerPrice,
        supplier: member.supplier,
        supplierOfferId: member.supplierOfferId,
        supplierHotelId: member.supplierHotelId,
        supplierReference: member.supplierReference,
        supplierPrice: priced.supplierPrice,
        commercialSnapshot: priced.commercialSnapshot,
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

function sanitizeHotelSearchForPublic(payload) {
  if (!payload || !Array.isArray(payload.hotels)) return payload;
  return {
    ...payload,
    hotels: payload.hotels.map((hotel) => ({
      ...hotel,
      availableRooms: (hotel.availableRooms || []).map((room) => {
        const {
          supplierPrice: _sp,
          commercialSnapshot: _cs,
          ...publicRoom
        } = room;
        return publicRoom;
      }),
    })),
  };
}

module.exports = { consolidateOffers, sanitizeHotelSearchForPublic };
