'use strict';

/**
 * Dummy stops for mock bus suppliers only.
 * Live supplier adapters must return their own points and must not call this.
 */

function clock(baseTime, offsetMinutes) {
  const match = String(baseTime || '00:00').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';
  const total = (Number(match[1]) * 60 + Number(match[2]) + offsetMinutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const CATALOG = {
  delhi: [
    ['Kashmere Gate ISBT', 'Kashmere Gate ISBT, New Delhi', 'Platform 4'],
    ['Anand Vihar ISBT', 'Anand Vihar ISBT, Delhi', 'Metro exit'],
    ['Sarai Kale Khan', 'Sarai Kale Khan ISBT, New Delhi', 'Bus bay 12'],
    ['Majnu-ka-Tilla', 'Majnu-ka-Tilla, Ring Road, Delhi', 'Monastery gate'],
    ['Dhaula Kuan', 'Dhaula Kuan, New Delhi', 'Flyover bus stop'],
  ],
  mumbai: [
    ['Dadar TT', 'Dadar TT, Mumbai', 'East exit'],
    ['Borivali East', 'Borivali East, Mumbai', 'Station road'],
    ['Bandra West', 'Bandra West, Mumbai', 'Linking Road junction'],
    ['Sion Circle', 'Sion Circle, Mumbai', 'Eastern Express Highway'],
    ['Vashi', 'Vashi, Navi Mumbai', 'Sector 17 bus depot'],
  ],
  'new york': [
    ['Port Authority Gate 42', '625 8th Avenue, New York', 'Gate 42'],
    ['Midtown Terminal Bay 7', 'West 34th Street, New York', 'Bay 7'],
    ['Hudson Yards Lounge', 'Hudson Yards, New York', 'Coach lounge'],
    ['George Washington Bridge', 'Fort Washington Avenue, New York', 'Upper level'],
    ['Chinatown East Broadway', 'East Broadway, New York', 'Corner of Market Street'],
  ],
  boston: [
    ['South Station Bay B', '700 Atlantic Avenue, Boston', 'Bay B'],
    ['Back Bay', '145 Dartmouth Street, Boston', 'Level 1'],
    ['Alewife', 'Alewife Brook Parkway, Cambridge', 'Station plaza'],
    ['Riverside', 'Riverside station, Newton', 'Busway'],
    ['Forest Hills', 'Washington Street, Jamaica Plain', 'Upper busway'],
  ],
};

function genericStops(city) {
  const label = city || 'City';
  return [1, 2, 3, 4, 5].map((index) => [
    `${label} stop ${index}`,
    `${label} bus stand ${index}`,
    `Bay ${index}`,
  ]);
}

function stopsFor(city) {
  const key = String(city || '').trim().toLowerCase();
  return CATALOG[key] || genericStops(city || 'City');
}

function buildPoints(rows, serviceId, kind, baseTime) {
  const offsets = [0, 15, 30, 45, 60];
  return rows.map((row, index) => ({
    code: `${serviceId}-${kind === 'boarding' ? 'B' : 'D'}${index + 1}`,
    name: row[0],
    time: clock(baseTime, offsets[index]),
    timeOffsetMinutes: offsets[index],
    address: row[1],
    landmark: row[2],
  }));
}

function attachMockStops(service) {
  return {
    ...service,
    boardingPoints: buildPoints(
      stopsFor(service.originCity),
      service.supplierServiceId,
      'boarding',
      service.departureTime,
    ),
    droppingPoints: buildPoints(
      stopsFor(service.destinationCity),
      service.supplierServiceId,
      'dropping',
      service.arrivalTime,
    ),
  };
}

module.exports = { attachMockStops };
