'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
const { getAllFlightAdapters } = require('../suppliers/registry');
const { normalizeCandidate } = require('../utils/flight-normalization');
const { resolveFlights } = require('../utils/flight-entity-resolution');
const {
  consolidateFlightOffers,
  expandFareFamilies,
  sanitizeFlightSearchForPublic,
} = require('../utils/offer-consolidation');
const { createPricingContext } = require('../../pricing/services/pricing-engine.service');
const Supplier = require('../../common/database/models/Supplier');
const { logSupplierOutcomes } = require('../../common/services/service-log.service');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const {
  buildSupplierExecutionPlan,
} = require('../../suppliers/services/supplier-routing.service');
const {
  resolveSupplierCredentials,
  toFailedOutcome,
  SupplierRuntimeError,
} = require('../../suppliers/runtime');
const Search = require('../../common/database/models/Search');
const { getCityByCode } = require('../data/airports');
const { flightAddOnCatalog } = require('../data/addons');
const {
  assertSearchTenantMatch,
} = require('../../tenant/services/transaction-tenant.service');

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

  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    searchId: aplSearchId,
    status: 'SUCCESS',
    request: criteria,
  });

  let plan;
  if (context.dsaId) {
    plan = await buildSupplierExecutionPlan({
      dsaId: context.dsaId,
      serviceCode: 'flight',
      operation: 'searchFlights',
    });
  } else {
    plan = {
      mode: 'LEGACY_MOCK_FANOUT',
      reason: 'NO_TRANSACTION_TENANT',
      strategy: 'PARALLEL',
      suppliers: getAllFlightAdapters().map((adapter, index) => ({
        supplierCode: adapter.code,
        priority: index + 1,
        adapter,
        supplierId: null,
      })),
    };
  }

  const adapterContext = {
    requestId: context.requestId,
    dsaId: context.dsaId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    routingMode: plan.mode,
    routingStrategy: plan.strategy,
  };

  const settled = await Promise.all(
    plan.suppliers.map(async (entry) => {
      const adapter = entry.adapter;
      const started = Date.now();
      try {
        const credentialRef =
          entry.credentialRef ||
          `SUPPLIER_${String(entry.supplierCode || adapter.code).toUpperCase()}`;
        const resolved = resolveSupplierCredentials({
          credentialRef,
          environment: entry.environment || 'TEST',
          supplierCode: entry.supplierCode || adapter.code,
        });

        const outcome = await adapter.searchFlights(criteria, {
          simulateFailure: forcedFailures.has(adapter.code),
          ...adapterContext,
          environment: entry.environment || 'TEST',
          supplierId: entry.supplierId || null,
          credentialRef,
          /** Safe metadata for adapter diagnostics (no secret values). */
          credentialMeta: resolved.meta,
          /**
           * In-memory secrets for real adapters only.
           * Must never be copied into supplierRequest/rawPayload/ServiceLog.
           */
          credentials: resolved.secrets,
          httpTimeoutMs: undefined,
        });
        return { adapter, outcome, supplierId: entry.supplierId };
      } catch (err) {
        const durationMs =
          err instanceof SupplierRuntimeError && err.details?.durationMs != null
            ? err.details.durationMs
            : Date.now() - started;
        return {
          adapter,
          supplierId: entry.supplierId,
          outcome: toFailedOutcome(err, durationMs),
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
  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || null,
    serviceCode: 'flight',
    tripType: criteria.tripType || null,
  });
  const flights = consolidateFlightOffers(clusters, pricingContext).sort(
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
    dsaId: context.dsaId || undefined,
    requestId: context.requestId || undefined,
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

  await logSupplierOutcomes({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    searchId: aplSearchId,
    userRequest: criteria,
    settled,
  });

  await writeLifecycleLog({
    stage: 'NORMALIZED_RESPONSE',
    direction: 'SUPPLIER',
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    searchId: aplSearchId,
    status: status === 'COMPLETED' ? 'SUCCESS' : 'PARTIAL',
    result: {
      searchId: aplSearchId,
      status,
      flightCount: flights.length,
      suppliers: supplierMeta,
      routing: { mode: plan.mode, strategy: plan.strategy, reason: plan.reason },
      pricingVersion: pricingContext.pricingVersion,
    },
  });

  return payload;
}

async function getFlightDetails({ searchId, aplFlightId, aplFareId }, context = {}) {
  const search = await getSearchOrThrow(searchId);
  if (context.tenant) {
    assertSearchTenantMatch(search, context.tenant);
  }
  const flight = findFlightInResults(search.results, aplFlightId);
  if (!flight) {
    throw AppError.notFound(`Flight not found in search: ${aplFlightId}`);
  }

  // Expand single-fare supplier rows into Saver/Publish/Flexi/Corporate so
  // checkout can resolve dynamic family selections from older search caches.
  const flightFareData = expandFareFamilies(
    flight.flightFareData || [],
    flight.aplFlightId,
  );
  let selectedFlightFareData = null;

  if (aplFareId) {
    selectedFlightFareData =
      findFareOnFlight({ ...flight, flightFareData }, aplFareId) ||
      flightFareData.find((f) => f.familyOf === aplFareId) ||
      null;
    if (!selectedFlightFareData) {
      // Fall back to the lowest/base fare; checkout may still accept a
      // selectedFareQuote that matches a known family tier.
      selectedFlightFareData = flightFareData[0] || null;
    }
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
      lowestPrice: flight.lowestPrice || fareForRules?.price || null,
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

async function revalidateFlightOffer(
  { searchId, aplFlightId, aplFareId },
  context = {},
) {
  if (!aplFareId) {
    throw AppError.validation(
      'aplFareId is required for revalidate (select a fare from flightFareData)',
    );
  }
  const details = await getFlightDetails(
    { searchId, aplFlightId, aplFareId },
    context,
  );
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
  sanitizeFlightSearchForPublic,
};
