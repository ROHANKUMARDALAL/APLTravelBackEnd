'use strict';

/**
 * Flat mock inventory keyed by airport pair (not metro city alone).
 * Delhi NCR: DEL (IGI), HDO (Hindon), DXN (Noida International) → BOM.
 */

function buildFlight({
  supplier,
  airlineCode,
  airlineName,
  flightNumber,
  origin,
  destination,
  depTime,
  arrTime,
  durationMinutes,
  amount,
  fareType = 'SAVER',
  refundable = false,
  seatsLeft = 6,
  aircraft = 'A320',
  criteria,
}) {
  const currency = criteria.currency || 'INR';
  const depDate = criteria.departDate;
  const key = `${airlineCode}${flightNumber}-${origin}${destination}`;

  return {
    supplier,
    supplierFlightId: `${supplier}-${key}`,
    supplierOfferId: `${supplier}-FARE-${key}`,
    supplierReference: `${supplier}-SESS-${key}`,
    airlineCode,
    airlineName,
    flightNumber: String(flightNumber),
    cabinClass: 'ECONOMY',
    fareType,
    refundable,
    baggage: { cabinKg: 7, checkinKg: refundable ? 20 : 15 },
    seatsLeft,
    segments: [
      {
        origin,
        destination,
        departureAt: `${depDate}T${depTime}+05:30`,
        arrivalAt: `${depDate}T${arrTime}+05:30`,
        durationMinutes,
        aircraft,
      },
    ],
    supplierPrice: { amount, currency },
    raw: { mock: true, source: supplier.toLowerCase(), flightKey: key },
  };
}

/** TBO: IGI (DEL) + Hindon (HDO) inventory toward BOM */
function getMockTboFlights(criteria) {
  const { origin, destination } = criteria;
  const list = [];

  if (origin === 'DEL' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'TBO',
        airlineCode: 'AI',
        airlineName: 'Air India',
        flightNumber: '865',
        origin: 'DEL',
        destination: 'BOM',
        depTime: '06:00:00',
        arrTime: '08:15:00',
        durationMinutes: 135,
        amount: 4850,
        fareType: 'SAVER',
        seatsLeft: 9,
        criteria,
      }),
      buildFlight({
        supplier: 'TBO',
        airlineCode: '6E',
        airlineName: 'IndiGo',
        flightNumber: '201',
        origin: 'DEL',
        destination: 'BOM',
        depTime: '09:30:00',
        arrTime: '11:45:00',
        durationMinutes: 135,
        amount: 4299,
        fareType: 'REGULAR',
        seatsLeft: 4,
        aircraft: 'A321',
        criteria,
      }),
    );
  }

  if (origin === 'HDO' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'TBO',
        airlineCode: 'QP',
        airlineName: 'Akasa Air',
        flightNumber: '1120',
        origin: 'HDO',
        destination: 'BOM',
        depTime: '07:40:00',
        arrTime: '10:00:00',
        durationMinutes: 140,
        amount: 3999,
        fareType: 'SAVER',
        seatsLeft: 11,
        criteria,
      }),
    );
  }

  if (origin === 'DXN' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'TBO',
        airlineCode: '6E',
        airlineName: 'IndiGo',
        flightNumber: '6401',
        origin: 'DXN',
        destination: 'BOM',
        depTime: '11:15:00',
        arrTime: '13:35:00',
        durationMinutes: 140,
        amount: 4150,
        fareType: 'REGULAR',
        seatsLeft: 8,
        criteria,
      }),
    );
  }

  if (origin === 'BOM' && destination === 'DEL') {
    list.push(
      buildFlight({
        supplier: 'TBO',
        airlineCode: 'AI',
        airlineName: 'Air India',
        flightNumber: '866',
        origin: 'BOM',
        destination: 'DEL',
        depTime: '19:05:00',
        arrTime: '21:20:00',
        durationMinutes: 135,
        amount: 5120,
        fareType: 'SAVER',
        seatsLeft: 7,
        criteria,
      }),
      buildFlight({
        supplier: 'TBO',
        airlineCode: '6E',
        airlineName: 'IndiGo',
        flightNumber: '208',
        origin: 'BOM',
        destination: 'DEL',
        depTime: '21:40:00',
        arrTime: '23:55:00',
        durationMinutes: 135,
        amount: 4680,
        fareType: 'REGULAR',
        seatsLeft: 5,
        criteria,
      }),
    );
  }

  return list;
}

module.exports = { getMockTboFlights };
