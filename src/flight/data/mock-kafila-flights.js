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

/** Kafila: IGI + Hindon toward BOM (AI865 duplicate for dedupe) */
function getMockKafilaFlights(criteria) {
  const { origin, destination } = criteria;
  const list = [];

  if (origin === 'DEL' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'KAFILA',
        airlineCode: 'AI',
        airlineName: 'Air India',
        flightNumber: '0865',
        origin: 'DEL',
        destination: 'BOM',
        depTime: '06:00:00',
        arrTime: '08:15:00',
        durationMinutes: 135,
        amount: 4990,
        fareType: 'SAVER',
        seatsLeft: 5,
        criteria,
      }),
      buildFlight({
        supplier: 'KAFILA',
        airlineCode: 'SG',
        airlineName: 'SpiceJet',
        flightNumber: '8169',
        origin: 'DEL',
        destination: 'BOM',
        depTime: '18:10:00',
        arrTime: '20:25:00',
        durationMinutes: 135,
        amount: 4550,
        fareType: 'SPICEMAX',
        seatsLeft: 3,
        aircraft: 'B737',
        criteria,
      }),
    );
  }

  if (origin === 'HDO' && destination === 'BOM') {
    list.push(
      buildFlight({
        supplier: 'KAFILA',
        airlineCode: 'I5',
        airlineName: 'AirAsia India',
        flightNumber: '772',
        origin: 'HDO',
        destination: 'BOM',
        depTime: '13:50:00',
        arrTime: '16:10:00',
        durationMinutes: 140,
        amount: 3699,
        fareType: 'SAVER',
        seatsLeft: 14,
        criteria,
      }),
    );
  }

  if (origin === 'BOM' && destination === 'DEL') {
    list.push(
      buildFlight({
        supplier: 'KAFILA',
        airlineCode: 'SG',
        airlineName: 'SpiceJet',
        flightNumber: '814',
        origin: 'BOM',
        destination: 'DEL',
        depTime: '17:25:00',
        arrTime: '19:40:00',
        durationMinutes: 135,
        amount: 4390,
        fareType: 'SAVER',
        seatsLeft: 8,
        criteria,
      }),
      buildFlight({
        supplier: 'KAFILA',
        airlineCode: 'AI',
        airlineName: 'Air India',
        flightNumber: '644',
        origin: 'BOM',
        destination: 'DEL',
        depTime: '20:15:00',
        arrTime: '22:30:00',
        durationMinutes: 135,
        amount: 5480,
        fareType: 'REGULAR',
        seatsLeft: 6,
        criteria,
      }),
    );
  }

  return list;
}

module.exports = { getMockKafilaFlights };
