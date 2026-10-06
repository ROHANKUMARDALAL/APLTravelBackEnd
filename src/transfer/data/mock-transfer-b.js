'use strict';

const { formatAplLocationId } = require('../services/location.service');

function pointKey(point) {
  return String(point?.aplLocationId || point?.name || '')
    .trim()
    .toLowerCase();
}

/**
 * Deterministic MOCKXFER_B inventory.
 * Overlaps Delhi Airport → Leela SEDAN (same category/capacity) for safe consolidation tests.
 */
function getMockTransferBInventory(criteria = {}) {
  const pickup = criteria.pickup || {};
  const dropoff = criteria.dropoff || {};
  const pickupKey = pointKey(pickup);
  const dropoffKey = pointKey(dropoff);
  const passengers = Number(criteria.passengers) || 1;
  const pickupDateTime = criteria.pickupDateTime;

  const routes = [
    {
      matchPickup: ['delhi airport', 'apl-apt-delhi-airport-del', 'del'],
      matchDrop: ['leela', 'connaught'],
      services: [
        // Overlap with MOCKXFER_A SEDAN for consolidation.
        {
          supplierServiceId: 'MXB-DEL-SEDAN',
          vehicleCategory: 'SEDAN',
          vehicleName: 'Comfort Sedan',
          maxPassengers: 3,
          maxLuggage: 2,
          estimatedDurationMinutes: 45,
          inclusions: ['Meet & greet', '60 min free waiting'],
          fareAmount: 1750,
        },
        {
          supplierServiceId: 'MXB-DEL-VAN',
          vehicleCategory: 'VAN',
          vehicleName: 'Group Van',
          maxPassengers: 8,
          maxLuggage: 8,
          estimatedDurationMinutes: 50,
          inclusions: ['Meet & greet', 'Extra luggage'],
          fareAmount: 3200,
        },
      ],
    },
    {
      matchPickup: ['bangalore airport', 'apl-apt-bangalore-airport-blr', 'blr'],
      matchDrop: ['gardenia', 'indiranagar'],
      services: [
        {
          supplierServiceId: 'MXB-BLR-SEDAN',
          vehicleCategory: 'SEDAN',
          vehicleName: 'Executive Sedan',
          maxPassengers: 3,
          maxLuggage: 2,
          estimatedDurationMinutes: 50,
          inclusions: ['Meet & greet', 'Toll included'],
          fareAmount: 1900,
        },
      ],
    },
  ];

  const matched = routes.find((row) => {
    const pOk = row.matchPickup.some((t) => pickupKey.includes(t));
    const dOk = row.matchDrop.some((t) => dropoffKey.includes(t));
    return pOk && dOk;
  });

  const baseServices = matched
    ? matched.services
    : [
        {
          supplierServiceId: `MXB-GEN-${pickupKey.slice(0, 12) || 'x'}-${dropoffKey.slice(0, 12) || 'y'}-SEDAN`,
          vehicleCategory: 'SEDAN',
          vehicleName: 'Alt Sedan',
          maxPassengers: 3,
          maxLuggage: 2,
          estimatedDurationMinutes: 42,
          inclusions: ['Private car'],
          fareAmount: 1399,
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

module.exports = { getMockTransferBInventory };
