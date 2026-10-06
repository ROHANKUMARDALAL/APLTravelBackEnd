'use strict';

const { formatAplLocationId } = require('../services/location.service');

function cityKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

/**
 * Deterministic MOCKBUS_B inventory.
 * Intentionally overlaps East Coast Express 07:30 NYC→BOS with MOCKBUS_A
 * (same operator + times) for safe consolidation tests.
 */
function getMockBusBInventory(criteria = {}) {
  const origin = cityKey(criteria.origin?.name || criteria.originCity);
  const destination = cityKey(criteria.destination?.name || criteria.destinationCity);
  const travelDate = criteria.travelDate || '2099-01-01';

  const routes = [
    {
      match: ['new york', 'boston'],
      services: [
        {
          // Overlap with MOCKBUS_A East Coast Express 07:30 for consolidation.
          supplierServiceId: 'MBB-NYC-BOS-0730',
          operator: 'East Coast Express',
          busType: 'Express coach',
          departureTime: '07:30',
          arrivalTime: '12:05',
          durationMinutes: 275,
          fromStation: 'Port Authority',
          toStation: 'South Station',
          amenities: ['Wi-Fi', 'Power outlets', 'Restroom'],
          seatsLeft: 10,
          fareAmount: 3100,
          currency: 'INR',
          boardingPoints: [
            { code: 'PA-42', name: 'Port Authority Gate 42', timeOffsetMinutes: 0 },
          ],
          droppingPoints: [
            { code: 'SS-B', name: 'South Station Bay B', timeOffsetMinutes: 0 },
          ],
        },
        {
          supplierServiceId: 'MBB-NYC-BOS-0915',
          operator: 'Northern Line Coaches',
          busType: 'Standard',
          departureTime: '09:15',
          arrivalTime: '14:40',
          durationMinutes: 325,
          fromStation: 'Midtown Terminal',
          toStation: 'South Station',
          amenities: ['Wi-Fi', 'AC'],
          seatsLeft: 28,
          fareAmount: 2400,
          currency: 'INR',
          boardingPoints: [
            { code: 'MT-7', name: 'Midtown Bay 7', timeOffsetMinutes: 0 },
          ],
          droppingPoints: [
            { code: 'SS-C', name: 'Curbside Atlantic Ave', timeOffsetMinutes: 0 },
          ],
        },
        {
          supplierServiceId: 'MBB-NYC-BOS-1545',
          operator: 'Metro Hopper',
          busType: 'Standard',
          departureTime: '15:45',
          arrivalTime: '21:10',
          durationMinutes: 325,
          fromStation: 'Port Authority',
          toStation: 'South Station',
          amenities: ['Wi-Fi', 'Restroom'],
          seatsLeft: 19,
          fareAmount: 2200,
          currency: 'INR',
          boardingPoints: [
            { code: 'PA-18', name: 'Port Authority Gate 18', timeOffsetMinutes: 0 },
          ],
          droppingPoints: [
            { code: 'SS-M', name: 'Main terminal', timeOffsetMinutes: 0 },
          ],
        },
      ],
    },
    {
      match: ['delhi', 'mumbai'],
      services: [
        {
          supplierServiceId: 'MBB-DEL-BOM-2200',
          operator: 'Western Trails',
          busType: 'AC Seater',
          departureTime: '22:00',
          arrivalTime: '11:00',
          durationMinutes: 780,
          fromStation: 'Anand Vihar',
          toStation: 'Borivali',
          amenities: ['AC', 'Charging', 'Water'],
          seatsLeft: 22,
          fareAmount: 1299,
          currency: 'INR',
          boardingPoints: [
            { code: 'AV-1', name: 'Anand Vihar ISBT', timeOffsetMinutes: 0 },
          ],
          droppingPoints: [
            { code: 'BOR-1', name: 'Borivali East', timeOffsetMinutes: 0 },
          ],
        },
      ],
    },
  ];

  const matched = routes.find(
    (row) => row.match[0] === origin && row.match[1] === destination,
  );
  if (!matched) {
    return [
      {
        supplierServiceId: `MBB-GEN-${origin || 'x'}-${destination || 'y'}-1100`,
        operator: 'Alt Route Buses',
        busType: 'Standard',
        departureTime: '11:00',
        arrivalTime: '17:30',
        durationMinutes: 390,
        fromStation: 'Main Stand',
        toStation: 'Arrival Stand',
        amenities: ['AC'],
        seatsLeft: 14,
        fareAmount: 899,
        currency: 'INR',
        originCity: criteria.origin?.name || criteria.originCity,
        destinationCity: criteria.destination?.name || criteria.destinationCity,
        boardingPoints: [
          { code: 'MS-1', name: 'Main Stand', timeOffsetMinutes: 0 },
        ],
        droppingPoints: [
          { code: 'AS-1', name: 'Arrival Stand', timeOffsetMinutes: 0 },
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

module.exports = { getMockBusBInventory };
