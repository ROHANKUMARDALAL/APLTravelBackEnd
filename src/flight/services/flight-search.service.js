'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
const { getAllFlightAdapters } = require('../suppliers/registry');
const { normalizeCandidate } = require('../utils/flight-normalization');
const { resolveFlights } = require('../utils/flight-entity-resolution');
const { consolidateFlightOffers } = require('../utils/offer-consolidation');
const Supplier = require('../../common/database/models/Supplier');
const SupplierRawPayload = require('../../common/database/models/SupplierRawPayload');
const { logSupplierOutcomes } = require('../../common/services/service-log.service');
const Search = require('../../common/database/models/Search');
const { getCityByCode } = require('../data/airports');
const { flightAddOnCatalog } = require('../data/addons');

async function ensureSuppliers() {
  for (const code of ['TBO', 'TRIPJACK', 'KAFILA']) {
    await Supplier.findOneAndUpdate(
      { code },
      {
        $set: {
          name: `${code} (Mock)`,
          status: 'ACTIVE',
          isMock: true,
        },
      },
      { upsert: true, new: true },
    );
  }
}

function findFlightInResults(results, aplFlightId) {
  if (!results?.flights) return null;
  return results.flights.find((f) => f.aplFlightId === aplFlightId) || null;
}

function findFareOnFlight(flight, aplFareId) {
  if (!flight?.flightFareData?.length) return null;
  if (!aplFareId) return null;
  return (
    flight.flightFareData.find(
      (f) => f.aplFareId === aplFareId || f.aplOfferId === aplFareId,
    ) || null
  );
}

async function getSearchOrThrow(searchId) {
  const search = await Search.findOne({ aplSearchId: searchId, type: 'FLIGHT' });
  if (!search) {
    throw AppError.notFound(`Flight search not found: ${searchId}`);
  }
  if (search.expiresAt && search.expiresAt < new Date()) {
    throw AppError.validation('Search has expired. Please search again.');
  }
  return search;
}

async function searchFlights(dto, forcedFailureList, context = {}) {
  const failureList = forcedFailureList ?? config.mockSupplierFailures;
  const criteria = { ...dto };
  const aplSearchId = formatAplSearchId(
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
  const forcedFailures = new Set(failureList);
  const adapters = getAllFlightAdapters();

  const settled = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const outcome = await adapter.searchFlights(criteria, {
          simulateFailure: forcedFailures.has(adapter.code),
        });
        return { adapter, outcome };
      } catch (err) {
        return {
          adapter,
          outcome: {
            status: 'FAILED',
            durationMs: 0,
            errorCode: 'SUPPLIER_EXCEPTION',
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
          },
        };
      }
    }),
  );

  const candidates = [];
  const supplierMeta = [];

  for (const { adapter, outcome } of settled) {
    if (outcome.status === 'SUCCESS') {
      console.log(
        `Flight supplier ${adapter.code} SUCCESS in ${outcome.durationMs}ms (${outcome.flights.length})`,
      );
      candidates.push(...outcome.flights);
      supplierMeta.push({
        supplier: adapter.code,
        status: 'SUCCESS',
        durationMs: outcome.durationMs,
        rawResultCount: outcome.flights.length,
      });
    } else {
      console.warn(
        `Flight supplier ${adapter.code} ${outcome.status}: ${outcome.errorMessage}`,
      );
      supplierMeta.push({
        supplier: adapter.code,
        status: outcome.status,
        durationMs: outcome.durationMs,
        rawResultCount: 0,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
    }
  }

  const normalized = candidates.map((c) => normalizeCandidate(c));
  const clusters = resolveFlights(normalized);
  const flights = consolidateFlightOffers(clusters).sort(
    (a, b) => a.lowestPrice.amount - b.lowestPrice.amount,
  );

  const successCount = supplierMeta.filter((s) => s.status === 'SUCCESS').length;
  const status =
    successCount === 0
      ? 'FAILED'
      : successCount < supplierMeta.length
        ? 'PARTIAL'
        : 'COMPLETED';

  if (status === 'FAILED') {
    throw new AppError(
      ErrorCode.SEARCH_FAILED,
      'All suppliers failed for this flight search',
      { httpStatus: 502, details: supplierMeta },
    );
  }

  await ensureSuppliers();

  const originCity = getCityByCode(criteria.originCityCode);
  const destinationCity = getCityByCode(criteria.destinationCityCode);

  const payload = {
    searchId: aplSearchId,
    status,
    tripType: criteria.tripType,
    originCity: {
      cityCode: originCity.cityCode,
      cityName: originCity.cityName,
      airports: originCity.airports,
      searchedAirportCodes: criteria.originAirports,
    },
    destinationCity: {
      cityCode: destinationCity.cityCode,
      cityName: destinationCity.cityName,
      airports: destinationCity.airports,
      searchedAirportCodes: criteria.destinationAirports,
    },
    route: {
      originCityCode: criteria.originCityCode,
      destinationCityCode: criteria.destinationCityCode,
      originAirports: criteria.originAirports,
      destinationAirports: criteria.destinationAirports,
      departDate: criteria.departDate,
      returnDate: criteria.returnDate,
    },
    passengers: {
      adults: criteria.adults,
      children: criteria.children,
      infants: criteria.infants,
    },
    flights,
    suppliers: supplierMeta,
  };

  await Search.create({
    aplSearchId,
    type: 'FLIGHT',
    status,
    request: criteria,
    results: payload,
    resultCount: flights.length,
    supplierResults: supplierMeta.map((m) => ({
      supplierCode: m.supplier,
      status: m.status,
      durationMs: m.durationMs,
      errorCode: m.errorCode,
      errorMessage: m.errorMessage,
      rawResultCount: m.rawResultCount,
    })),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  for (const { adapter, outcome } of settled) {
    await SupplierRawPayload.create({
      supplierCode: adapter.code,
      searchId: aplSearchId,
      operation: 'FLIGHT_SEARCH',
      payload:
        outcome.status === 'SUCCESS'
          ? outcome.rawPayload
      : { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage },
  });
  }

  await logSupplierOutcomes({
    requestId: context.requestId,
    userId: context.userId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    searchId: aplSearchId,
    userRequest: criteria,
    settled,
  });

  return payload;
}

async function getFlightDetails({ searchId, aplFlightId, aplFareId }) {
  const search = await getSearchOrThrow(searchId);
  const flight = findFlightInResults(search.results, aplFlightId);
  if (!flight) {
    throw AppError.notFound(`Flight not found in search: ${aplFlightId}`);
  }

  const flightFareData = flight.flightFareData || [];
  let selectedFlightFareData = null;

  if (aplFareId) {
    selectedFlightFareData = findFareOnFlight(flight, aplFareId);
    if (!selectedFlightFareData) {
      throw AppError.notFound(
        `Fare not found on flight ${aplFlightId}: ${aplFareId}`,
      );
    }
  } else if (flightFareData.length > 0) {
    // Default selection = lowest fare (helps details without forcing fare id yet)
    selectedFlightFareData = flightFareData[0];
  }

  const fareForRules = selectedFlightFareData || flightFareData[0];

  return {
    searchId,
    aplFlightId: flight.aplFlightId,
    flight: {
      aplFlightId: flight.aplFlightId,
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      cabinClass: flight.cabinClass,
      segments: flight.segments,
      durationMinutes: flight.durationMinutes,
      departure: flight.departure,
      arrival: flight.arrival,
      supplierMappings: flight.supplierMappings,
      lowestPrice: flight.lowestPrice,
    },
    /** All supplier fares for this canonical flight */
    flightFareData,
    /** Selected fare (explicit aplFareId, else lowest) */
    selectedFlightFareData,
    addOns: flightAddOnCatalog(
      fareForRules?.price?.currency || flight.lowestPrice?.currency || 'INR',
    ),
    fareRules: fareForRules
      ? {
          refundable: fareForRules.refundable,
          changeable: fareForRules.fareType === 'FLEXI',
          freeMeal: fareForRules.fareType !== 'SAVER',
          notes: [
            'Mock fare rules for Postman testing only.',
            'Cancellation charges apply after booking (dummy).',
          ],
        }
      : null,
    baggage: fareForRules?.baggage || null,
  };
}

async function revalidateFlightOffer({ searchId, aplFlightId, aplFareId }) {
  if (!aplFareId) {
    throw AppError.validation(
      'aplFareId is required for revalidate (select a fare from flightFareData)',
    );
  }
  const details = await getFlightDetails({ searchId, aplFlightId, aplFareId });
  const fare = details.selectedFlightFareData;
  return {
    searchId,
    aplFlightId,
    aplFareId: fare.aplFareId,
    status: 'AVAILABLE',
    priceChanged: false,
    price: fare.price,
    seatsLeft: fare.seatsLeft,
    supplier: fare.supplier,
    supplierReference: fare.supplierReference,
    selectedFlightFareData: fare,
    validUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

module.exports = {
  searchFlights,
  getFlightDetails,
  revalidateFlightOffer,
  findFlightInResults,
  findFareOnFlight,
  getSearchOrThrow,
};
