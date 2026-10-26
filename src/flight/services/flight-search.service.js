'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
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
const { newJourneyId, searchJourneyShell, lockSelectedOffer, logFlightOperation, resolveJourneySearch } = require('./flight-journey.service');
const { assertFareConfirmation } = require('./flight-journey.policy');
const {
  buildSupplierExecutionPlan,
} = require('../../suppliers/services/supplier-routing.service');
const { executeSupplierPlan } = require('../../suppliers/services/supplier-execution.service');
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
const { shareOperation, recallOperation, rememberOperation } = require('../../common/services/operation-dedupe');

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
  const journeyId = newJourneyId();
  const journey = searchJourneyShell(journeyId, context.requestId);
  const forcedFailures = new Set(failureList);

  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    journeyId,
    businessOperation: 'SEARCH',
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    searchId: aplSearchId,
    status: 'SUCCESS',
    request: criteria,
  });

  if (!context.dsaId) {
    throw AppError.noSupplier('No supplier is assigned for this service');
  }
  const plan = await buildSupplierExecutionPlan({
    dsaId: context.dsaId,
    serviceCode: 'flight',
    operation: 'searchFlights',
  });

  const adapterContext = {
    requestId: context.requestId,
    dsaId: context.dsaId,
    service: 'FLIGHT',
    operation: 'searchFlights',
    routingMode: plan.mode,
    routingStrategy: plan.strategy,
  };

  const executed = await executeSupplierPlan(plan, {
    isUsable: (outcome) => outcome?.status === 'SUCCESS' && (outcome.flights || []).length > 0,
    invoke: async (entry) => {
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
        return await adapter.searchFlights(criteria, {
          simulateFailure: forcedFailures.has(adapter.code),
          ...adapterContext,
          environment: entry.environment || 'TEST',
          supplierId: entry.supplierId || null,
          credentialRef,
          credentialMeta: resolved.meta,
          credentials: resolved.secrets,
          httpTimeoutMs: config.supplierHttpTimeoutMs,
        });
      } catch (err) {
        const durationMs =
          err instanceof SupplierRuntimeError && err.details?.durationMs != null
            ? err.details.durationMs
            : Date.now() - started;
        return toFailedOutcome(err, durationMs);
      }
    },
  });
  const settled = executed.settled;

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
    originCode: criteria.originCityCode || null,
    destinationCode: criteria.destinationCityCode || null,
    customerId: context.userId || null,
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
    journeyId,
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
    userId: context.userId || undefined,
    requestId: context.requestId || undefined,
    journeyId,
    journeys: [journey],
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
    journeyId,
    businessOperation: 'SEARCH',
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
    journeyId,
    businessOperation: 'SEARCH',
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

async function revalidateFlightOffer(args, context = {}) {
  const key = [
    'fare',
    args.searchId,
    args.aplFlightId,
    args.aplFareId || '',
    context.acceptPriceChange ? '1' : '0',
    context.simulatePriceChange ? '1' : '0',
    context.expired ? '1' : '0',
    context.asReturn ? '1' : '0',
    String(context.supplier || '').toUpperCase(),
  ].join(':');
  const cached = recallOperation(key);
  if (cached && !context.simulatePriceChange && !context.expired) {
    return { ...cached, idempotentReplay: true };
  }
  return shareOperation(key, async () => {
    const body = await revalidateFlightOfferBody(args, context);
    if (body?.status === 'AVAILABLE') rememberOperation(key, body, 10 * 60 * 1000);
    return body;
  });
}

async function revalidateFlightOfferBody(
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
  if (
    context.supplier
    && String(context.supplier).toUpperCase() !== String(fare.supplier || '').toUpperCase()
  ) {
    throw AppError.validation('Selected supplier does not match this offer');
  }
  const { getFlightAdapter } = require('../suppliers/registry');
  const adapter = getFlightAdapter(fare.supplier);
  if (!adapter || typeof adapter.fareQuote !== 'function') {
    throw AppError.validation('Fare confirmation is not available for this supplier');
  }
  const quoted = await adapter.fareQuote(
    {
      ...fare,
      segments: details.flight?.segments,
      supplierPrice: fare.supplierPrice || fare.price,
      refundable: fare.refundable,
      baggage: fare.baggage,
    },
    {
      simulatePriceChange: context.simulatePriceChange === true,
      expired: context.expired === true,
    },
  );
  if (!quoted || quoted.status === 'UNAVAILABLE' || quoted.status === 'EXPIRED') {
    const search = await resolveJourneySearch(await getSearchOrThrow(searchId), context);
    const journey = await lockSelectedOffer(search, {
      aplFlightId,
      aplFareId: fare.aplFareId,
      supplier: fare.supplier,
      supplierOfferId: fare.supplierOfferId,
      supplierReference: fare.supplierReference,
    }, {
      requestId: context.requestId,
      clientJourneyId: context.clientJourneyId || null,
      asReturn: context.asReturn === true,
    });
    if (context.requestId) {
      await logFlightOperation({
        businessOperation: 'CONFIRM_FARE',
        journey,
        requestId: context.requestId,
        dsaId: context.dsaId || context.tenant?.dsaId,
        userId: context.userId,
        searchId,
        supplierCode: fare.supplier,
        mainRequest: { searchId, aplFlightId, aplFareId: fare.aplFareId, supplier: fare.supplier },
        supplierRequest: { supplier: fare.supplier, supplierOfferId: fare.supplierOfferId || null },
        supplierResponse: quoted,
        mainResponse: { status: quoted?.status || 'UNAVAILABLE' },
        status: 'FAILED',
        httpStatus: 400,
        errorMessage: quoted?.status === 'EXPIRED'
          ? 'Fare quote has expired. Please search again.'
          : 'The selected fare is not available.',
      });
    }
    throw AppError.validation(
      quoted?.status === 'EXPIRED'
        ? 'Fare quote has expired. Please search again.'
        : 'The selected fare is not available.',
    );
  }
  const priceChanged = Boolean(quoted.priceChanged) && context.acceptPriceChange !== true;
  const confirmation = {
    status: priceChanged ? 'PRICE_CHANGED' : 'CONFIRMED',
    quoteId: quoted.quoteId,
    supplier: fare.supplier,
    aplFareId: fare.aplFareId,
    aplFlightId,
    supplierPrice: quoted.price,
    currency: quoted.price?.currency || fare.supplierPrice?.currency || 'INR',
    expiresAt: quoted.expiresAt,
    confirmedAt: priceChanged ? null : new Date().toISOString(),
    supplierReference: fare.supplierReference || null,
  };
  const search = await resolveJourneySearch(await getSearchOrThrow(searchId), context);
  const journey = await lockSelectedOffer(
    search,
    {
      aplFlightId,
      aplFareId: fare.aplFareId,
      supplier: fare.supplier,
      supplierOfferId: fare.supplierOfferId,
      supplierReference: fare.supplierReference,
      quoteId: quoted.quoteId || null,
      expiresAt: quoted.expiresAt || null,
      fareConfirmation: confirmation,
    },
    {
      requestId: context.requestId,
      operationKey: 'confirmFareRequestId',
      clientJourneyId: context.clientJourneyId || null,
      asReturn: context.asReturn === true,
    },
  );
  const body = {
    searchId,
    journeyId: journey.journeyId,
    aplFlightId,
    aplFareId: fare.aplFareId,
    status: priceChanged ? 'PRICE_CHANGED' : 'AVAILABLE',
    priceChanged,
    requiresAcceptance: priceChanged,
    previousPrice: quoted.previousPrice || fare.supplierPrice || fare.price,
    price: priceChanged ? quoted.price : fare.price,
    supplierPrice: quoted.price,
    quoteId: quoted.quoteId || null,
    seatsLeft: fare.seatsLeft,
    supplier: fare.supplier,
    supplierReference: fare.supplierReference,
    selectedFlightFareData: fare,
    fareRules: quoted?.fareRules || null,
    baggage: quoted?.baggage || fare.baggage || null,
    flight: details.flight,
    testBooking: true,
    validUntil: quoted?.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  if (context.requestId) {
    await logFlightOperation({
      businessOperation: 'CONFIRM_FARE',
      journey,
      requestId: context.requestId,
      dsaId: context.dsaId || context.tenant?.dsaId,
      userId: context.userId,
      searchId,
      supplierCode: fare.supplier,
      mainRequest: { searchId, aplFlightId, aplFareId: fare.aplFareId, supplier: fare.supplier },
      supplierRequest: { supplier: fare.supplier, supplierOfferId: fare.supplierOfferId || null },
      supplierResponse: quoted,
      mainResponse: {
        status: body.status,
        priceChanged: body.priceChanged,
        quoteId: body.quoteId,
        price: body.price,
        supplier: fare.supplier,
      },
      status: 'SUCCESS',
    });
  }
  return body;
}

async function getFlightSsr(args, context = {}) {
  const key = [
    'ssr',
    args.searchId,
    args.aplFlightId,
    args.aplFareId || '',
    context.asReturn ? '1' : '0',
    String(context.supplier || '').toUpperCase(),
  ].join(':');
  const cached = recallOperation(key);
  if (cached) return { ...cached, idempotentReplay: true };
  return shareOperation(key, async () => {
    const body = await getFlightSsrBody(args, context);
    if (body?.segments) rememberOperation(key, body, 10 * 60 * 1000);
    return body;
  });
}

async function getFlightSsrBody({ searchId, aplFlightId, aplFareId }, context = {}) {
  const details = await getFlightDetails({ searchId, aplFlightId, aplFareId }, context);
  const { getFlightAdapter } = require('../suppliers/registry');
  const fare = details.selectedFlightFareData;
  const supplier = fare?.supplier;
  if (
    context.supplier
    && String(context.supplier).toUpperCase() !== String(supplier || '').toUpperCase()
  ) {
    throw AppError.validation('Selected supplier does not match this offer');
  }
  const adapter = getFlightAdapter(supplier);
  if (!adapter || typeof adapter.getSsr !== 'function') {
    throw AppError.validation('SSR is not available for this supplier');
  }
  const search = await resolveJourneySearch(await getSearchOrThrow(searchId), context);
  const journey = await lockSelectedOffer(
    search,
    {
      aplFlightId,
      aplFareId: fare.aplFareId,
      supplier,
      supplierOfferId: fare.supplierOfferId,
      supplierReference: fare.supplierReference,
    },
    {
      requestId: context.requestId,
      operationKey: 'ssrRequestId',
      clientJourneyId: context.clientJourneyId || null,
      asReturn: context.asReturn === true,
    },
  );
  if (journey.supplier && journey.supplier !== supplier) {
    throw AppError.validation('Selected supplier does not match the stored offer');
  }
  try {
    assertFareConfirmation(journey, { aplFareId: fare.aplFareId, supplier, asReturn: context.asReturn === true });
  } catch (error) {
    if (context.requestId) {
      await logFlightOperation({
        businessOperation: 'SSR',
        journey,
        requestId: context.requestId,
        dsaId: context.dsaId || context.tenant?.dsaId,
        userId: context.userId,
        searchId,
        supplierCode: supplier,
        mainRequest: { searchId, aplFlightId, aplFareId: fare.aplFareId, supplier },
        mainResponse: { status: 'FAILED' },
        status: 'FAILED',
        httpStatus: 400,
        errorMessage: error.message,
      });
    }
    throw error;
  }
  const started = Date.now();
  const offer = {
    ...fare,
    segments: details.flight?.segments,
    supplierPrice: fare?.supplierPrice,
    refundable: fare?.refundable,
    baggage: details.baggage,
  };
  const inventory = await adapter.getSsr(offer);
  const body = {
    searchId,
    journeyId: journey.journeyId,
    aplFlightId,
    aplFareId: fare.aplFareId,
    supplier,
    testBooking: true,
    ...inventory,
  };
  if (context.requestId) {
    await logFlightOperation({
      businessOperation: 'SSR',
      journey,
      requestId: context.requestId,
      dsaId: context.dsaId || context.tenant?.dsaId,
      userId: context.userId,
      searchId,
      supplierCode: supplier,
      mainRequest: { searchId, aplFlightId, aplFareId: fare.aplFareId, supplier },
      supplierRequest: { supplier, supplierOfferId: fare.supplierOfferId || null },
      supplierResponse: inventory,
      mainResponse: {
        supplier,
        segmentCount: inventory?.segments?.length || 0,
        testBooking: true,
      },
      status: inventory?.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      durationMs: Date.now() - started,
    });
  }
  return body;
}

module.exports = {
  searchFlights,
  getFlightDetails,
  revalidateFlightOffer,
  getFlightSsr,
  findFlightInResults,
  findFareOnFlight,
  getSearchOrThrow,
  sanitizeFlightSearchForPublic,
};
