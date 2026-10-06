'use strict';

const { formatAplLocationId } = require('../services/location.service');

function pointKey(point) {
  return String(point?.aplLocationId || point?.name || '')
    .trim()
    .toLowerCase();
}

/**
 * Deterministic MOCKXFER_A inventory.
 */
function getMockTransferAInventory(criteria = {}) {
  const pickup = criteria.pickup || {};
  const dropoff = criteria.dropoff || {};
  const pickupKey = pointKey(pickup);
  const dropoffKey = pointKey(dropoff);
  const passengers = Number(criteria.passengers) || 1;
  const pickupDateTime = criteria.pickupDateTime;

  const airportHotel = [
    {
      matchPickup: ['delhi airport', 'apl-apt-delhi-airport-del', 'del'],
      matchDrop: ['leela', 'connaught'],
      services: [
        {
          supplierServiceId: 'MXA-DEL-SEDAN',
          vehicleCategory: 'SEDAN',
          vehicleName: 'Comfort Sedan',
          maxPassengers: 3,
          maxLuggage: 2,
          estimatedDurationMinutes: 45,
          inclusions: ['Meet & greet', '60 min free waiting', 'Toll included'],
          fareAmount: 1800,
        },
        {
          supplierServiceId: 'MXA-DEL-SUV',
          vehicleCategory: 'SUV',
          vehicleName: 'Premium SUV',
          maxPassengers: 5,
          maxLuggage: 4,
          estimatedDurationMinutes: 45,
          inclusions: ['Meet & greet', 'Child seat on request', 'Toll included'],
          fareAmount: 2600,
        },
      ],
    },
    {
      matchPickup: ['mumbai airport', 'apl-apt-mumbai-airport-bom', 'bom'],
      matchDrop: ['taj', 'bandra'],
      services: [
        {
          supplierServiceId: 'MXA-BOM-SEDAN',
          vehicleCategory: 'SEDAN',
          vehicleName: 'City Sedan',
          maxPassengers: 3,
          maxLuggage: 2,
          estimatedDurationMinutes: 55,
          inclusions: ['Meet & greet', 'Toll included'],
          fareAmount: 2100,
        },
      ],
    },
  ];

  const matched = airportHotel.find((row) => {
    const pOk = row.matchPickup.some((t) => pickupKey.includes(t));
    const dOk = row.matchDrop.some((t) => dropoffKey.includes(t));
    return pOk && dOk;
  });

  const baseServices = matched
    ? matched.services
    : [
        {
          supplierServiceId: `MXA-GEN-${pickupKey.slice(0, 12) || 'x'}-${dropoffKey.slice(0, 12) || 'y'}-SEDAN`,
          vehicleCategory: 'SEDAN',
          vehicleName: 'Standard Sedan',
          maxPassengers: 3,
          maxLuggage: 2,
          estimatedDurationMinutes: 40,
          inclusions: ['Private car', 'Driver'],
          fareAmount: 1499,
        },
        {
          supplierServiceId: `MXA-GEN-${pickupKey.slice(0, 12) || 'x'}-${dropoffKey.slice(0, 12) || 'y'}-SUV`,
          vehicleCategory: 'SUV',
          vehicleName: 'Standard SUV',
          maxPassengers: 6,
          maxLuggage: 4,
          estimatedDurationMinutes: 40,
          inclusions: ['Private car', 'Driver', 'Extra luggage space'],
          fareAmount: 2199,
        },
      ];

  return baseServices
    .filter((svc) => svc.maxPassengers >= passengers)
    .map((svc) => ({
      ...svc,
      currency: 'INR',
      transferType: criteria.transferType || 'AIRPORT_TRANSFER',
      pickup: {
        ...pickup,
        aplLocationId:
          pickup.aplLocationId ||
          formatAplLocationId(pickup.name, pickup.kind || 'CITY'),
      },
      dropoff: {
        ...dropoff,
        aplLocationId:
          dropoff.aplLocationId ||
          formatAplLocationId(dropoff.name, dropoff.kind || 'CITY'),
      },
      pickupDateTime,
      cancellationNote:
        'Mock free cancellation up to 2h before pickup — not a real operator rule',
    }));
}

module.exports = { getMockTransferAInventory };
