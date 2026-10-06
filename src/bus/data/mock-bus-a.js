'use strict';

const { formatAplLocationId } = require('../services/location.service');

function cityKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

/**
 * Deterministic MOCKBUS_A inventory keyed by origin/destination city names.
 */
function getMockBusAInventory(criteria = {}) {
  const origin = cityKey(criteria.origin?.name || criteria.originCity);
  const destination = cityKey(criteria.destination?.name || criteria.destinationCity);
  const travelDate = criteria.travelDate || '2099-01-01';

  const routes = [
    {
      match: ['new york', 'boston'],
      services: [
        {
          supplierServiceId: 'MBA-NYC-BOS-0700',
          operator: 'East Coast Express',
          busType: 'Express coach',
          departureTime: '07:30',
          arrivalTime: '12:05',
          durationMinutes: 275,
          fromStation: 'Port Authority',
          toStation: 'South Station',
          amenities: ['Wi-Fi', 'Power outlets', 'Restroom'],
          seatsLeft: 12,
          fareAmount: 3200,
          currency: 'INR',
          boardingPoints: [
            { code: 'PA-42', name: 'Port Authority Gate 42', timeOffsetMinutes: 0 },
            { code: 'MT-07', name: 'Midtown Terminal Bay 7', timeOffsetMinutes: 15 },
          ],
          droppingPoints: [
            { code: 'SS-B', name: 'South Station Bay B', timeOffsetMinutes: 0 },
          ],
        },
        {
          supplierServiceId: 'MBA-NYC-BOS-1200',
          operator: 'LuxRide',
          busType: 'Luxury',
          departureTime: '12:00',
          arrivalTime: '16:20',
          durationMinutes: 260,
          fromStation: 'Hudson Yards',
          toStation: 'Back Bay',
          amenities: ['Wi-Fi', 'Power outlets', 'Snacks', 'Extra legroom'],
          seatsLeft: 6,
          fareAmount: 4800,
          currency: 'INR',
          boardingPoints: [
            { code: 'HY-1', name: 'Hudson Yards Lounge', timeOffsetMinutes: 0 },
          ],
          droppingPoints: [
            { code: 'BB-1', name: 'Back Bay Level 1', timeOffsetMinutes: 0 },
          ],
        },
        {
          supplierServiceId: 'MBA-NYC-BOS-2230',
          operator: 'NightOwl Coach',
          busType: 'Sleeper',
          departureTime: '22:30',
          arrivalTime: '03:45',
          durationMinutes: 315,
          fromStation: 'Port Authority',
          toStation: 'South Station',
          amenities: ['Recliner seats', 'Wi-Fi', 'Blanket'],
          seatsLeft: 9,
          fareAmount: 2800,
          currency: 'INR',
          boardingPoints: [
            { code: 'PA-03', name: 'Port Authority Gate 3', timeOffsetMinutes: 0 },
          ],
          droppingPoints: [
            { code: 'SS-N', name: 'Overnight bay', timeOffsetMinutes: 0 },
          ],
        },
      ],
    },
    {
      match: ['delhi', 'mumbai'],
      services: [
        {
          supplierServiceId: 'MBA-DEL-BOM-2100',
          operator: 'NorthWest Volvo',
          busType: 'AC Sleeper',
          departureTime: '21:00',
          arrivalTime: '09:30',
          durationMinutes: 750,
          fromStation: 'Kashmere Gate',
          toStation: 'Dadar',
          amenities: ['Sleeper berth', 'Blanket', 'Charging'],
          seatsLeft: 18,
          fareAmount: 1599,
          currency: 'INR',
          boardingPoints: [
            { code: 'KG-1', name: 'Kashmere Gate ISBT', timeOffsetMinutes: 0 },
            { code: 'SK-1', name: 'Sarai Kale Khan', timeOffsetMinutes: 40 },
          ],
          droppingPoints: [
            { code: 'DDR-1', name: 'Dadar TT', timeOffsetMinutes: 0 },
            { code: 'BKC-1', name: 'BKC Drop', timeOffsetMinutes: 25 },
          ],
        },
      ],
    },
  ];

  const matched = routes.find(
    (row) => row.match[0] === origin && row.match[1] === destination,
  );
  if (!matched) {
    // Generic fallback so arbitrary cities still return deterministic results.
    return [
      {
        supplierServiceId: `MBA-GEN-${origin || 'x'}-${destination || 'y'}-0900`,
        operator: 'Mock Coach Lines',
        busType: 'Standard',
        departureTime: '09:00',
        arrivalTime: '15:00',
        durationMinutes: 360,
        fromStation: 'Central Terminal',
        toStation: 'City Depot',
        amenities: ['Wi-Fi', 'AC'],
        seatsLeft: 20,
        fareAmount: 999,
        currency: 'INR',
        originCity: criteria.origin?.name || criteria.originCity,
        destinationCity: criteria.destination?.name || criteria.destinationCity,
        boardingPoints: [
          { code: 'CT-1', name: 'Central Terminal', timeOffsetMinutes: 0 },
        ],
        droppingPoints: [
          { code: 'CD-1', name: 'City Depot', timeOffsetMinutes: 0 },
        ],
        travelDate,
      },
    ];
  }

  return matched.services.map((svc) => ({
    ...svc,
    originCity: criteria.origin?.name || criteria.originCity,
    destinationCity: criteria.destination?.name || criteria.destinationCity,
    originAplLocationId:
      criteria.origin?.aplLocationId ||
      formatAplLocationId(criteria.origin?.name || criteria.originCity),
    destinationAplLocationId:
      criteria.destination?.aplLocationId ||
      formatAplLocationId(criteria.destination?.name || criteria.destinationCity),
    travelDate,
  }));
}

module.exports = { getMockBusAInventory };
