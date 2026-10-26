'use strict';

const CheckoutSession = require('../../common/database/models/CheckoutSession');
const { AppError } = require('../../common/errors/app-error');
const { getFlightAdapter } = require('../suppliers/registry');
const { getFlightDetails } = require('./flight-search.service');
const { loadSearchForOffer, lockSelectedOffer, logFlightOperation } = require('./flight-journey.service');
const {
  BLOCK_TTL_MS,
  newBlockRef,
  assertSameSupplier,
  assertFareConfirmation,
  assertBlockUsable,
} = require('./flight-journey.policy');
const { shareOperation } = require('../../common/services/operation-dedupe');

function seatStillFree(inventory, segmentKey, code) {
  const segment = (inventory?.segments || []).find((row) => row.segmentKey === segmentKey);
  if (!segment) return false;
  const seat = (segment.seats || []).find((row) => row.code === code);
  return Boolean(seat && seat.status === 'AVAILABLE');
}

function publicBlock(session) {
  const block = session.block || {};
  return {
    checkoutToken: session.checkoutToken,
    journeyId: session.journeyId,
    blockRef: block.blockRef,
    supplier: block.supplier,
    supplierBlockRef: block.supplierBlockRef || null,
    status: block.status,
    availability: block.availability || null,
    amount: block.amount,
    currency: block.currency,
    ssrStatus: block.ssrStatus || null,
    holdSupported: block.holdSupported === true,
    holdStatus: block.holdStatus || 'NOT_HELD',
    priceChanged: Boolean(block.priceChangePending),
    requiresAcceptance: Boolean(block.priceChangePending),
    expiresAt: block.expiresAt,
    testBooking: true,
  };
}

async function blockFlight(dto, context = {}) {
  const token = String(dto.checkoutToken || '').trim();
  if (!token) throw AppError.validation('checkoutToken is required');
  const key = [
    'block',
    token,
    context.acceptPriceChange ? '1' : '0',
    context.simulatePriceChange ? '1' : '0',
    context.simulateBlockFailure ? '1' : '0',
    String(dto.supplier || '').toUpperCase(),
  ].join(':');
  return shareOperation(key, () => blockFlightBody(dto, context));
}

async function blockFlightBody(dto, context = {}) {
  const token = String(dto.checkoutToken || '').trim();
  if (dto.supplier) {
    const session = await CheckoutSession.findOne({ checkoutToken: token }).select('offerSnapshot.supplier');
    const locked = session?.offerSnapshot?.supplier;
    if (locked && String(dto.supplier).toUpperCase() !== String(locked).toUpperCase()) {
      throw AppError.validation('Selected supplier does not match the checkout offer');
    }
  }
  const session = await CheckoutSession.findOne({ checkoutToken: token });
  if (!session || session.productType !== 'FLIGHT') {
    throw AppError.notFound('Checkout session not found');
  }
  if (context.tenant?.dsaId && String(session.dsaId) !== String(context.tenant.dsaId)) {
    throw AppError.forbidden('Checkout does not belong to this business');
  }
  if (session.userId && context.userId && String(session.userId) !== String(context.userId)) {
    throw AppError.forbidden('Checkout does not belong to this customer');
  }
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    throw AppError.validation('Checkout has expired. Search again.');
  }
  if (['BOOKED', 'CANCELLED'].includes(session.status)) {
    throw AppError.validation('Checkout is no longer open');
  }

  const snapshot = session.offerSnapshot || {};
  const supplier = snapshot.supplier;
  assertSameSupplier(supplier, snapshot.returnJourney?.supplier);
  const adapter = getFlightAdapter(supplier);
  if (!adapter || typeof adapter.blockFlight !== 'function') {
    throw AppError.validation('Block is not available for this supplier');
  }

  const search = await loadSearchForOffer(session.searchId, context.tenant);
  const journey = await lockSelectedOffer(
    search,
    {
      aplFlightId: snapshot.aplFlightId,
      aplFareId: snapshot.aplFareId,
      supplier,
      supplierOfferId: snapshot.flightFareData?.supplierOfferId,
      supplierReference: snapshot.flightFareData?.supplierReference,
    },
    {
      requestId: context.requestId,
      operationKey: 'blockRequestId',
      clientJourneyId: dto.journeyId || null,
    },
  );
  if (journey.supplier && journey.supplier !== supplier) {
    throw AppError.validation('Selected supplier does not match the stored offer');
  }
  try {
    assertFareConfirmation(journey, { aplFareId: snapshot.aplFareId, supplier });
  } catch (error) {
    if (context.requestId) {
      await logFlightOperation({
        businessOperation: 'BLOCK',
        journey,
        requestId: context.requestId,
        dsaId: context.tenant?.dsaId,
        userId: context.userId,
        searchId: session.searchId,
        supplierCode: supplier,
        mainRequest: { checkoutToken: token, supplier },
        mainResponse: { status: 'FAILED' },
        status: 'FAILED',
        httpStatus: 400,
        errorMessage: error.message,
      });
    }
    throw error;
  }

  const current = session.block;
  if (
    current?.status === 'ACCEPTED' &&
    current.expiresAt &&
    new Date(current.expiresAt).getTime() > Date.now() &&
    !current.priceChangePending
  ) {
    return publicBlock(session);
  }

  const details = await getFlightDetails(
    { searchId: session.searchId, aplFlightId: snapshot.aplFlightId, aplFareId: snapshot.aplFareId },
    context,
  );
  const started = Date.now();
  const inventory = typeof adapter.getSsr === 'function'
    ? await adapter.getSsr({
        ...details.selectedFlightFareData,
        segments: details.flight?.segments,
      })
    : { segments: [] };

  const addOns = Array.isArray(snapshot.addOns) ? snapshot.addOns : [];
  for (const extra of addOns) {
    if (!extra?.code) continue;
    const looksLikeSeat = /^[0-9]+[A-Z]$/i.test(String(extra.code));
    if (looksLikeSeat && extra.segmentKey && !seatStillFree(inventory, extra.segmentKey, extra.code)) {
      const failed = {
        status: 'FAILED',
        errorCode: 'SEAT_UNAVAILABLE',
        errorMessage: `Seat ${extra.code} is not available on this segment`,
      };
      await logFlightOperation({
        businessOperation: 'BLOCK',
        journey,
        requestId: context.requestId,
        dsaId: session.dsaId,
        userId: context.userId,
        searchId: session.searchId,
        supplierCode: supplier,
        mainRequest: { checkoutToken: token, passengers: session.travellers?.length || 0 },
        supplierRequest: { supplier, offerId: snapshot.aplFareId, seat: extra.code, segmentKey: extra.segmentKey },
        supplierResponse: failed,
        mainResponse: failed,
        status: 'FAILED',
        httpStatus: 400,
        durationMs: Date.now() - started,
        errorCode: failed.errorCode,
        errorMessage: failed.errorMessage,
      });
      throw AppError.validation(failed.errorMessage);
    }
  }

  const quoted = typeof adapter.fareQuote === 'function'
    ? await adapter.fareQuote(details.selectedFlightFareData, {
        simulatePriceChange: context.simulatePriceChange === true,
      })
    : null;
  if (quoted?.priceChanged && context.acceptPriceChange !== true) {
    session.block = {
      status: 'PRICE_CHANGED',
      priceChangePending: true,
      supplier,
      amount: session.pricing?.amount,
      currency: session.pricing?.currency,
      previousPrice: quoted.previousPrice,
      price: quoted.price,
    };
    await session.save();
    throw AppError.validation('The supplier fare changed. Review the new amount before blocking.', [
      { priceChanged: true, previousPrice: quoted.previousPrice, price: quoted.price },
    ]);
  }

  const supplierResult = await adapter.blockFlight(
    {
      ...details.selectedFlightFareData,
      segments: details.flight?.segments,
      addOns,
    },
    { simulateFailure: context.simulateBlockFailure === true },
  );
  if (!supplierResult || supplierResult.status !== 'SUCCESS') {
    await logFlightOperation({
      businessOperation: 'BLOCK',
      journey,
      requestId: context.requestId,
      dsaId: session.dsaId,
      userId: context.userId,
      searchId: session.searchId,
      supplierCode: supplier,
      mainRequest: { checkoutToken: token },
      supplierRequest: { supplier, offerId: snapshot.aplFareId },
      supplierResponse: supplierResult,
      mainResponse: { blocked: false },
      status: 'FAILED',
      httpStatus: 502,
      durationMs: Date.now() - started,
      errorCode: supplierResult?.errorCode,
      errorMessage: supplierResult?.errorMessage,
    });
    throw AppError.validation(
      supplierResult?.errorMessage || 'The supplier could not block this fare. Refresh the quote and try again.',
    );
  }

  const expiresAt = new Date(Date.now() + BLOCK_TTL_MS).toISOString();
  session.block = {
    blockRef: newBlockRef(),
    status: 'ACCEPTED',
    supplier,
    supplierBlockRef: supplierResult.supplierBlockRef || null,
    availability: 'AVAILABLE',
    amount: session.pricing.amount,
    currency: session.pricing.currency,
    ssrStatus: addOns.length ? 'VALIDATED' : 'NONE',
    holdSupported: supplierResult.holdSupported === true,
    holdStatus: supplierResult.holdStatus || 'NOT_HELD',
    priceChangePending: false,
    expiresAt,
    quoteId: journey.quoteId || quoted?.quoteId || null,
  };
  session.journeyId = journey.journeyId;
  if (context.userId && !session.userId) session.userId = context.userId;
  await session.save();

  const body = publicBlock(session);
  await logFlightOperation({
    businessOperation: 'BLOCK',
    journey,
    requestId: context.requestId,
    dsaId: session.dsaId,
    userId: context.userId,
    searchId: session.searchId,
    supplierCode: supplier,
    mainRequest: {
      checkoutToken: token,
      passengers: (session.travellers || []).length,
      quoteId: body.supplierBlockRef,
    },
    supplierRequest: { supplier, offerId: snapshot.aplFareId, quoteId: journey.quoteId || null },
    supplierResponse: supplierResult,
    mainResponse: body,
    status: 'SUCCESS',
    durationMs: Date.now() - started,
  });
  return body;
}

function assertPaymentBlock(session) {
  if (!session || session.productType !== 'FLIGHT') return;
  assertBlockUsable(session.block, session.pricing?.amount);
}

module.exports = {
  blockFlight,
  assertPaymentBlock,
  publicBlock,
};
