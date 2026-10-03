'use strict';

const {
  formatAplOfferId,
  stableSeqFromKey,
} = require('../../common/utils/apl-ids');
const { applyMarkup } = require('./pricing');
const { getAirportMeta } = require('../data/airports');

function airportBlock(code) {
  const meta = getAirportMeta(code);
  if (!meta) {
    return { airportCode: code, airportName: code, shortName: code };
  }
  return {
    airportCode: meta.airportCode,
    airportName: meta.airportName,
    shortName: meta.shortName,
    area: meta.area,
    cityCode: meta.cityCode,
    cityName: meta.cityName,
  };
}

/** Family tiers used by B2C when a supplier returns a single fare. */
const FARE_FAMILY_TIERS = [
  { fareType: 'SAVER', multiplier: 1, refundable: false, cabinKg: 7, checkinKg: 15 },
  { fareType: 'PUBLISH', multiplier: 1.08, refundable: false, cabinKg: 7, checkinKg: 20 },
  { fareType: 'FLEXI', multiplier: 1.18, refundable: true, cabinKg: 7, checkinKg: 25 },
  { fareType: 'CORPORATE', multiplier: 1.26, refundable: true, cabinKg: 10, checkinKg: 30 },
];

function expandFareFamilies(flightFareData, aplFlightId) {
  if (!Array.isArray(flightFareData) || flightFareData.length !== 1) {
    return flightFareData;
  }
  const base = flightFareData[0];
  const baseAmount = Number(base?.price?.amount);
  const currency = base?.price?.currency || 'INR';
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return flightFareData;

  return FARE_FAMILY_TIERS.map((tier) => {
    const amount = Math.round(baseAmount * tier.multiplier);
    const fareKey = [
      aplFlightId,
      base.supplier || 'FAMILY',
      base.supplierOfferId || base.aplFareId || 'BASE',
      tier.fareType,
    ].join('|');
    return {
      ...base,
      aplFareId:
        tier.multiplier === 1
          ? base.aplFareId
          : formatAplOfferId(stableSeqFromKey(fareKey)),
      fareType: tier.fareType,
      refundable: tier.refundable,
      baggage: {
        cabinKg: tier.cabinKg,
        checkinKg: tier.checkinKg,
      },
      price: { amount, currency },
      familyOf: base.aplFareId,
    };
  });
}

function consolidateFlightOffers(clusters) {
  return clusters.map((cluster) => {
    const mappingsMap = new Map();
    const flightFareData = [];

    for (const member of cluster.members) {
      mappingsMap.set(`${member.supplier}:${member.supplierFlightId}`, {
        supplier: member.supplier,
        supplierFlightId: member.supplierFlightId,
      });

      const priced = applyMarkup(member.supplierPrice);
      const fareKey = [
        cluster.aplFlightId,
        member.supplier,
        member.supplierOfferId,
      ].join('|');

      flightFareData.push({
        aplFareId: formatAplOfferId(stableSeqFromKey(fareKey)),
        cabinClass: member.cabinClass,
        fareType: member.fareType,
        refundable: member.refundable,
        baggage: member.baggage,
        seatsLeft: member.seatsLeft,
        price: priced.customer,
        supplier: member.supplier,
        supplierOfferId: member.supplierOfferId,
        supplierFlightId: member.supplierFlightId,
        supplierReference: member.supplierReference,
        supplierPrice: priced.supplier,
      });
    }

    const fares = expandFareFamilies(flightFareData, cluster.aplFlightId).sort(
      (a, b) => a.price.amount - b.price.amount,
    );
    const c = cluster.canonical;
    const firstSeg = c.segments[0];
    const lastSeg = c.segments[c.segments.length - 1];
    const depAirport = airportBlock(firstSeg.origin);
    const arrAirport = airportBlock(lastSeg.destination);

    return {
      aplFlightId: cluster.aplFlightId,
      airline: {
        code: c.airlineCode,
        name: c.airlineName,
      },
      flightNumber: `${c.airlineCode}${c.flightNumber}`,
      cabinClass: c.cabinClass,
      durationMinutes: c.segments.reduce(
        (sum, s) => sum + (s.durationMinutes || 0),
        0,
      ),
      segments: c.segments.map((s) => ({
        ...s,
        originAirport: airportBlock(s.origin),
        destinationAirport: airportBlock(s.destination),
      })),
      departure: {
        airport: firstSeg.origin,
        airportInfo: depAirport,
        at: firstSeg.departureAt,
      },
      arrival: {
        airport: lastSeg.destination,
        airportInfo: arrAirport,
        at: lastSeg.arrivalAt,
      },
      supplierMappings: Array.from(mappingsMap.values()),
      flightFareData: fares,
      lowestPrice: {
        amount: fares[0].price.amount,
        currency: fares[0].price.currency,
      },
    };
  });
}

module.exports = { consolidateFlightOffers, expandFareFamilies };
