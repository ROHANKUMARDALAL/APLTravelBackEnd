'use strict';

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

/** TripJack: IGI + Noida International toward BOM (includes AI865 duplicate for dedupe) */
function getMockTripjackFlights(criteria) {
  const { origin, destination } = criteria;
  const list = [];

  if (origin === 'DEL' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'TRIPJACK',
        airlineCode: 'AI',
        airlineName: 'AIR INDIA',
        flightNumber: '865',
        origin: 'DEL',
        destination: 'BOM',
        depTime: '06:00:00',
        arrTime: '08:15:00',
        durationMinutes: 135,
        amount: 4725,
        fareType: 'SAVER',
        seatsLeft: 7,
        aircraft: 'A320neo',
        criteria,
      }),
      buildFlight({
        supplier: 'TRIPJACK',
        airlineCode: 'UK',
        airlineName: 'Vistara',
        flightNumber: '995',
        origin: 'DEL',
        destination: 'BOM',
        depTime: '14:20:00',
        arrTime: '16:40:00',
        durationMinutes: 140,
        amount: 6100,
        fareType: 'FLEXI',
        refundable: true,
        seatsLeft: 12,
        aircraft: 'B737',
        criteria,
      }),
    );
  }

  if (origin === 'DXN' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'TRIPJACK',
        airlineCode: 'SG',
        airlineName: 'SpiceJet',
        flightNumber: '9011',
        origin: 'DXN',
        destination: 'BOM',
        depTime: '16:05:00',
        arrTime: '18:25:00',
        durationMinutes: 140,
        amount: 3899,
        fareType: 'SPICEMAX',
        seatsLeft: 5,
        aircraft: 'B737',
        criteria,
      }),
    );
  }

  if (origin === 'BOM' && destination === 'DEL') {
    list.push(
      buildFlight({
        supplier: 'TRIPJACK',
        airlineCode: '6E',
        airlineName: 'IndiGo',
        flightNumber: '214',
        origin: 'BOM',
        destination: 'DEL',
        depTime: '15:10:00',
        arrTime: '17:25:00',
        durationMinutes: 135,
        amount: 4210,
        fareType: 'REGULAR',
        seatsLeft: 9,
        criteria,
      }),
      buildFlight({
        supplier: 'TRIPJACK',
        airlineCode: 'SG',
        airlineName: 'SpiceJet',
        flightNumber: '870',
        origin: 'BOM',
        destination: 'DEL',
        depTime: '22:05:00',
        arrTime: '23:50:00',
        durationMinutes: 135,
        amount: 3990,
        fareType: 'SAVER',
        seatsLeft: 4,
        criteria,
      }),
    );
  }

  return list;
}

module.exports = { getMockTripjackFlights };
