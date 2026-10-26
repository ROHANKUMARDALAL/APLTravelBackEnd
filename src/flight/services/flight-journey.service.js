'use strict';

const Search = require('../../common/database/models/Search');
const { AppError } = require('../../common/errors/app-error');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const {
  newJourneyId,
  selectJourneyForOffer,
} = require('./flight-journey.policy');

function searchJourneyShell(journeyId, requestId) {
  return {
    journeyId,
    parentJourneyId: null,
    role: 'SEARCH',
    aplFareId: null,
    aplFlightId: null,
    supplier: null,
    searchRequestId: requestId || null,
  };
}

async function lockSelectedOffer(search, offer, context = {}) {
  if (!search) throw AppError.validation('Search is required');
  if (context.asReturn) {
    const journeys = Array.isArray(search.journeys) ? search.journeys.map((row) => ({ ...row })) : [];
    const parent = journeys.find((row) => row.journeyId === (context.clientJourneyId || search.journeyId));
    if (!parent || !parent.aplFareId) {
      throw AppError.validation('Journey does not match the selected offer');
    }
    if (parent.supplier && offer.supplier && parent.supplier !== offer.supplier) {
      throw AppError.validation(
        'This round trip uses two suppliers. A single block is refused. Book each supplier itinerary on its own.',
      );
    }
    parent.returnAplFareId = offer.aplFareId;
    parent.returnAplFlightId = offer.aplFlightId;
    parent.returnSupplier = offer.supplier;
    if (offer.fareConfirmation) parent.returnFareConfirmation = offer.fareConfirmation;
    if (context.operationKey && context.requestId) parent[context.operationKey] = context.requestId;
    search.journeys = journeys;
    search.markModified('journeys');
    await search.save();
    return parent;
  }
  const selected = selectJourneyForOffer(
    search.journeys,
    search.journeyId,
    offer,
    context.clientJourneyId || null,
  );
  const journey = selected.journey;
  journey.supplier = offer.supplier;
  journey.supplierOfferId = offer.supplierOfferId || journey.supplierOfferId || null;
  journey.supplierReference = offer.supplierReference || journey.supplierReference || null;
  if (offer.quoteId) journey.quoteId = offer.quoteId;
  if (offer.expiresAt) journey.expiresAt = offer.expiresAt;
  if (offer.fareConfirmation) journey.fareConfirmation = offer.fareConfirmation;
  if (context.operationKey && context.requestId) {
    journey[context.operationKey] = context.requestId;
  }
  search.journeys = selected.journeys;
  search.markModified('journeys');
  await search.save();
  return journey;
}

async function resolveJourneySearch(search, context = {}) {
  if (!context.asReturn || !context.clientJourneyId) return search;
  const owns = search.journeyId === context.clientJourneyId
    || (search.journeys || []).some((row) => row.journeyId === context.clientJourneyId);
  if (owns) return search;
  const owner = await Search.findOne({
    type: 'FLIGHT',
    $or: [
      { journeyId: context.clientJourneyId },
      { 'journeys.journeyId': context.clientJourneyId },
    ],
  });
  return owner || search;
}

async function loadSearchForOffer(searchId, tenant) {
  const search = await Search.findOne({ aplSearchId: searchId });
  if (!search) throw AppError.notFound('Search not found');
  if (tenant?.dsaId && search.dsaId && String(search.dsaId) !== String(tenant.dsaId)) {
    throw AppError.forbidden('Search does not belong to this business');
  }
  return search;
}

async function logFlightOperation({
  businessOperation,
  journey,
  requestId,
  dsaId,
  userId,
  searchId,
  supplierCode,
  mainRequest,
  supplierRequest,
  supplierResponse,
  mainResponse,
  status = 'SUCCESS',
  httpStatus = 200,
  durationMs,
  errorCode,
  errorMessage,
}) {
  const common = {
    requestId,
    journeyId: journey?.journeyId,
    parentJourneyId: journey?.parentJourneyId || undefined,
    businessOperation,
    operation: businessOperation,
    dsaId,
    userId,
    service: 'FLIGHT',
    searchId,
    supplierCode: businessOperation === 'PAYMENT' ? undefined : supplierCode,
  };
  await writeLifecycleLog({
    ...common,
    stage: 'INBOUND_REQUEST',
    direction: 'INBOUND',
    status: status === 'FAILED' ? 'FAILED' : 'SUCCESS',
    httpStatus,
    request: mainRequest,
  });
  if (supplierRequest != null || supplierResponse != null) {
    await writeLifecycleLog({
      ...common,
      stage: 'SUPPLIER_REQUEST',
      direction: 'SUPPLIER',
      status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      httpStatus: status === 'SUCCESS' ? 200 : 502,
      durationMs: 0,
      storeRaw: true,
      rawPayload: supplierRequest || {},
      supplierRequest: supplierRequest || null,
    });
    await writeLifecycleLog({
      ...common,
      stage: 'SUPPLIER_RESPONSE',
      direction: 'SUPPLIER',
      status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      httpStatus: status === 'SUCCESS' ? 200 : 502,
      durationMs,
      storeRaw: true,
      rawPayload: supplierResponse || { errorCode, errorMessage },
      errorCode,
      errorMessage,
    });
  }
  await writeLifecycleLog({
    ...common,
    stage: 'OUTBOUND_RESPONSE',
    direction: 'INBOUND',
    status,
    httpStatus,
    durationMs,
    result: mainResponse,
    errorCode,
    errorMessage,
  });
}

module.exports = {
  newJourneyId,
  searchJourneyShell,
  lockSelectedOffer,
  resolveJourneySearch,
  loadSearchForOffer,
  logFlightOperation,
};
