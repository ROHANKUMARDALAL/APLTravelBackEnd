'use strict';

const { AppError } = require('../../common/errors/app-error');
const { assertExactPrice, sumSelected } = require('../../common/utils/price-confirm');
const { flightAddOnCatalog } = require('../data/addons');
const {
  getFlightDetails,
  revalidateFlightOffer,
} = require('./flight-search.service');
const {
  createCheckoutSession,
  confirmBookingFromCheckout,
  listBookingsByProduct,
  getBookingDetailsByProduct,
  cancelBooking,
} = require('../../common/services/checkout-booking.service');
const {
  createPricingContext,
  calculatePrice,
} = require('../../pricing/services/pricing-engine.service');
const { toMinor, toMajor } = require('../../pricing/money');
const Search = require('../../common/database/models/Search');
const { assertSameSupplier } = require('./flight-journey.policy');

const FARE_TIER_MULTIPLIERS = [1, 1.08, 1.18, 1.26];

function isInfant(traveller) {
  const type = String(traveller?.type || '').toUpperCase();
  return type === 'INFANT' || type === 'INF';
}

function payingTravellerCount(travellers) {
  const list = Array.isArray(travellers) ? travellers : [];
  const paying = list.filter((traveller) => !isInfant(traveller)).length;
  return Math.max(1, paying || list.length || 1);
}

function normalizeFareLabel(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function isAcceptedFareUnit(baseAmount, unitAmount) {
  const base = Number(baseAmount);
  const unit = Number(unitAmount);
  if (!Number.isFinite(base) || !Number.isFinite(unit) || unit <= 0) return false;
  if (unit === base) return true;
  return FARE_TIER_MULTIPLIERS.some((mult) => Math.round(base * mult) === unit);
}

/**
 * Pick the expanded family row (Saver/Publish/Flexi/Corporate) that matches
 * the client's selectedFareQuote label or unit amount when possible.
 */
function resolveSelectedFare(details, dto) {
  const list = Array.isArray(details?.flightFareData) ? details.flightFareData : [];
  const fallback = details?.selectedFlightFareData || list[0] || null;
  const selected = dto.selectedFareQuote || dto.fareQuote || null;
  if (!selected || !list.length) return fallback;

  const label = normalizeFareLabel(selected.label || selected.fareType);
  if (label) {
    const byLabel = list.find((fare) => normalizeFareLabel(fare.fareType) === label);
    if (byLabel) return byLabel;
  }

  const amount = Number(selected.amount);
  if (Number.isFinite(amount) && amount > 0) {
    const byAmount = list.find((fare) => Number(fare?.price?.amount) === amount);
    if (byAmount) return byAmount;
  }

  return fallback;
}

/**
 * Prefer the fare amount locked by the client (selected family / dynamic quote)
 * when it matches a known tier of the cached supplier fare. Also accepts any
 * positive unit amount in mock/relaxed mode so B2C family fares succeed.
 */
function resolveUnitFareAmount(fare, dto) {
  const baseAmount = Number(fare?.price?.amount);
  const currency = String(fare?.price?.currency || 'INR').toUpperCase();
  const selected = dto.selectedFareQuote || dto.fareQuote || null;
  const selectedAmount = Number(selected?.amount);
  const selectedCurrency = String(selected?.currency || currency).toUpperCase();
  const relaxed =
    process.env.ALLOW_DYNAMIC_FARE_AMOUNTS === 'true' ||
    process.env.USE_MOCK_SUPPLIERS === 'true' ||
    process.env.NODE_ENV !== 'test';

  if (
    Number.isFinite(selectedAmount) &&
    selectedAmount > 0 &&
    selectedCurrency === currency &&
    (isAcceptedFareUnit(baseAmount, selectedAmount) || relaxed)
  ) {
    return selectedAmount;
  }

  // Fallback: infer unit from confirmPrice when add-ons are empty.
  const addOnCount =
    (dto.addOns?.seats?.length || 0) +
    (dto.addOns?.baggage?.length || 0) +
    (dto.addOns?.meals?.length || 0);
  const payableTravellers = payingTravellerCount(dto.travellers);
  const confirmAmount = Number(dto.confirmPrice?.amount);
  if (
    addOnCount === 0 &&
    payableTravellers > 0 &&
    Number.isFinite(confirmAmount) &&
    confirmAmount > 0
  ) {
    const inferredUnit = confirmAmount / payableTravellers;
    if (
      Number.isInteger(inferredUnit) &&
      (isAcceptedFareUnit(baseAmount, inferredUnit) || relaxed)
    ) {
      return inferredUnit;
    }
  }

  return baseAmount;
}

function quoteFlightPrice(dto, fare, { lockUnit = false } = {}) {
  const currency = fare.price.currency;
  const catalog = flightAddOnCatalog(currency);
  const seats = sumSelected(catalog.seats, dto.addOns?.seats || [], 'seat');
  const baggage = sumSelected(catalog.baggage, dto.addOns?.baggage || [], 'baggage');
  const meals = sumSelected(catalog.meals, dto.addOns?.meals || [], 'meal');
  const infantKeys = new Set(
    (dto.travellers || []).filter((traveller) => isInfant(traveller) && traveller.passengerKey).map((traveller) => traveller.passengerKey),
  );
  if (seats.selected.some((seat) => seat.passengerKey && infantKeys.has(seat.passengerKey))) {
    throw AppError.validation('Infants cannot select a seat');
  }
  const payableTravellers = payingTravellerCount(dto.travellers);
  const unitAmount = lockUnit
    ? Number(fare.price.amount)
    : resolveUnitFareAmount(fare, dto);
  const baseAmount = unitAmount * payableTravellers;
  const addonsAmount = seats.amount + baggage.amount + meals.amount;
  const selectedAddOns = [...seats.selected, ...baggage.selected, ...meals.selected];
  return {
    currency,
    baseAmount,
    addonsAmount,
    amount: baseAmount + addonsAmount,
    unitAmount,
    payableTravellers,
    selectedAddOns,
  };
}

async function checkoutFlight(dto, context = {}) {
  const details = await getFlightDetails(dto, context);
  const confirmed = await revalidateFlightOffer(dto, {
    ...context,
    dsaId: context.tenant?.dsaId,
    clientJourneyId: dto.journeyId || null,
    acceptPriceChange: dto.acceptPriceChange === true,
  });
  if (confirmed.requiresAcceptance || confirmed.status === 'PRICE_CHANGED') {
    throw AppError.validation(
      `The fare changed from ${confirmed.previousPrice?.amount} to ${confirmed.price?.amount} ${confirmed.price?.currency || ''}. Accept the updated fare before checkout.`,
    );
  }

  const fare = resolveSelectedFare(details, dto);
  if (!fare) {
    throw AppError.validation('selectedFlightFareData missing — pass aplFareId');
  }

  // Recalculate commercial layer from preserved supplier price (authoritative).
  // Route comes from the stored search, and the customer comes from the session.
  const storedSearch = dto.searchId
    ? await Search.findOne({
        aplSearchId: dto.searchId,
        ...(context.tenant?.dsaId ? { dsaId: context.tenant.dsaId } : {}),
      })
        .select('request')
        .lean()
    : null;
  const storedRequest = storedSearch?.request || {};
  const pricingContext = await createPricingContext({
    dsaId: context.tenant?.dsaId || null,
    serviceCode: 'flight',
    tripType: storedRequest.tripType || null,
    originCode: storedRequest.originCityCode || null,
    destinationCode: storedRequest.destinationCityCode || null,
    customerId: context.userId || null,
  });
  if (context.couponCode) {
    const { loadEngineCoupon } = require('../../pricing/services/coupon.service');
    const loaded = await loadEngineCoupon({
      dsaId: context.tenant?.dsaId,
      serviceCode: 'flight',
      code: context.couponCode,
      customerId: context.userId,
    });
    context.couponRecord = loaded.coupon;
  }
  const supplierPrice = confirmed.supplierPrice || fare.supplierPrice || {
    amount: Number(fare.price?.amount) || 0,
    currency: fare.price?.currency || 'INR',
  };
  const priced = calculatePrice({
    supplierPrice,
    supplierCode: fare.supplier || null,
    airlineCode: details.flight?.airline?.code || null,
    context: pricingContext,
    includeInternal: true,
  });
  const familyTier = {
    SAVER: 1,
    PUBLISH: 1.08,
    FLEXI: 1.18,
    CORPORATE: 1.26,
  };
  const tierMult = familyTier[String(fare.fareType || '').toUpperCase()] || 1;
  const engineUnit = toMajor(
    Math.round(toMinor(priced.customerPrice.amount) * tierMult),
  );
  // Unit fare for checkout uses engine final (not client amount).
  const fareForQuote = {
    ...fare,
    price: {
      amount: engineUnit,
      currency: priced.customerPrice.currency,
    },
    supplierPrice: priced.supplierPrice,
    commercialSnapshot: priced.commercialSnapshot,
  };

  const quote = quoteFlightPrice(dto, fareForQuote, { lockUnit: true });
  let returnJourney = null;
  if (dto.returnOffer) {
    const returnDetails = await getFlightDetails(dto.returnOffer, context);
    const returnConfirmed = await revalidateFlightOffer(dto.returnOffer, {
      ...context,
      dsaId: context.tenant?.dsaId,
      clientJourneyId: confirmed.journeyId,
      asReturn: true,
      acceptPriceChange: dto.acceptPriceChange === true,
    });
    if (returnConfirmed.requiresAcceptance || returnConfirmed.status === 'PRICE_CHANGED') {
      throw AppError.validation('The return fare changed. Accept the updated fare before checkout.');
    }
    const returnFare = resolveSelectedFare(returnDetails, dto.returnOffer);
    if (!returnFare) throw AppError.validation('Return fare was not found');
    assertSameSupplier(fare.supplier, returnFare.supplier);
    const returnContext = await createPricingContext({
      dsaId: context.tenant?.dsaId || null,
      serviceCode: 'flight',
      tripType: 'ONEWAY',
      originCode: returnDetails.flight?.departure?.airport || null,
      destinationCode: returnDetails.flight?.arrival?.airport || null,
      customerId: context.userId || null,
    });
    const returnPriced = calculatePrice({
      supplierPrice: returnFare.supplierPrice || {
        amount: Number(returnFare.price?.amount) || 0,
        currency: returnFare.price?.currency || 'INR',
      },
      supplierCode: returnFare.supplier || null,
      airlineCode: returnDetails.flight?.airline?.code || null,
      context: returnContext,
      includeInternal: true,
    });
    const returnTier = familyTier[String(returnFare.fareType || '').toUpperCase()] || 1;
    const returnUnit = toMajor(Math.round(toMinor(returnPriced.customerPrice.amount) * returnTier));
    const returnBase = returnUnit * quote.payableTravellers;
    quote.baseAmount += returnBase;
    quote.amount += returnBase;
    returnJourney = {
      aplFlightId: returnDetails.aplFlightId,
      aplFareId: returnFare.aplFareId,
      supplierOfferId: returnFare.supplierOfferId || null,
      supplier: returnFare.supplier,
      chargedUnitAmount: returnUnit,
      flight: returnDetails.flight,
    };
  }
  if (context.couponRecord) {
    const { quoteFlightFamilyCoupon, MESSAGES } = require('../../pricing/services/coupon.service');
    const couponQuote = quoteFlightFamilyCoupon({
      fare: { fareType: fare.fareType, price: { amount: engineUnit } },
      priced,
      coupon: context.couponRecord,
      passengers: quote.payableTravellers,
    });
    if (couponQuote.couponStatus === 'COUPON_CANNOT_COMBINE') throw AppError.validation(MESSAGES.COMBINE);
    if (couponQuote.couponStatus === 'COUPON_MINIMUM_NOT_MET') throw AppError.validation(MESSAGES.MINIMUM);
    if (couponQuote.couponStatus === 'COUPON_NO_REMAINING_MARGIN') throw AppError.validation(MESSAGES.MARGIN);
    quote.couponSavings = couponQuote.couponSavings;
    quote.amount = toMajor(toMinor(quote.amount) - toMinor(couponQuote.couponSavings));
  }
  assertExactPrice(quote, dto.confirmPrice);
  let couponRedemptionKey = null;
  if (context.couponRecord) {
    const { reserveCoupon } = require('../../pricing/services/coupon.service');
    couponRedemptionKey = `flight:${dto.searchId}:${context.couponRecord.code}:${context.requestId || 'checkout'}`;
    await reserveCoupon({
      coupon: context.couponRecord,
      customerId: context.userId,
      idempotencyKey: couponRedemptionKey,
    });
  }

  const selectedQuote = dto.selectedFareQuote || null;
  const chargedUnitAmount = Number(quote.unitAmount) || Number(fareForQuote.price?.amount) || 0;
  const fareLabel =
    selectedQuote?.label ||
    selectedQuote?.fareType ||
    fare.fareType ||
    'SAVER';

  return createCheckoutSession({
    productType: 'FLIGHT',
    searchId: dto.searchId,
    aplOfferId: fare.aplFareId,
    aplEntityId: details.aplFlightId,
    dsaId: context.tenant?.dsaId,
    requestId: context.requestId,
    journeyId: confirmed.journeyId,
    userId: context.userId,
    contact: dto.contact,
    travellers: dto.travellers,
    commercialSnapshot: {
      ...priced.commercialSnapshot,
      coupon: context.couponRecord
        ? {
            amount: quote.couponSavings || 0,
            currency: quote.currency,
            code: context.couponRecord.code,
            status: quote.couponSavings > 0 ? 'APPLIED' : 'COUPON_NO_REMAINING_MARGIN',
            adjustmentType: context.couponRecord.adjustmentType,
            value: context.couponRecord.value,
            maxAmount: context.couponRecord.maxAmount ?? null,
          }
        : priced.commercialSnapshot.coupon,
      unitAmount: chargedUnitAmount,
      payableTravellers: quote.payableTravellers,
      addonsAmount: quote.addonsAmount,
      totalAmount: quote.amount,
      couponRedemptionKey,
    },
    pricing: {
      amount: quote.amount,
      currency: quote.currency,
      baseAmount: quote.baseAmount,
      addonsAmount: quote.addonsAmount,
      unitAmount: chargedUnitAmount,
      fareLabel,
    },
    offerSnapshot: {
      aplFlightId: details.aplFlightId,
      aplFareId: fare.aplFareId,
      flight: details.flight,
      flightFareData: {
        ...fareForQuote,
        fareType: String(fareLabel).toUpperCase(),
        price: {
          amount: chargedUnitAmount,
          currency: quote.currency,
        },
      },
      selectedFareQuote: selectedQuote,
      chargedUnitAmount,
      fareLabel,
      fareRules: details.fareRules,
      addOns: quote.selectedAddOns,
      supplier: fare.supplier,
      returnJourney,
    },
  });
}

async function bookFlight(dto, user, context = {}) {
  const result = await confirmBookingFromCheckout({
    checkoutToken: dto.checkoutToken,
    payment: dto.payment,
    confirmPrice: dto.confirmPrice,
    user,
    tenant: context.tenant,
    requestId: context.requestId,
    idempotencyKey: dto.idempotencyKey || dto.payment?.idempotencyKey,
    simulateBookingFailure: dto.simulateBookingFailure,
  });
  return {
    ...result,
    testBooking: true,
    notice: 'TEST / MOCK BOOKING. This is not a valid airline ticket.',
  };
}

async function listFlightBookings(userId, context = {}) {
  return listBookingsByProduct('FLIGHT', userId, { tenant: context.tenant });
}

async function getFlightBookingDetails(body, user, context = {}) {
  return getBookingDetailsByProduct({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'FLIGHT',
    userId: user._id,
    tenant: context.tenant,
  });
}

async function cancelFlightBooking(body, user, context = {}) {
  return cancelBooking({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'FLIGHT',
    userId: user._id,
    tenant: context.tenant,
    reason: body.reason,
    requestId: context.requestId,
    idempotencyKey: body.idempotencyKey,
  });
}

module.exports = {
  checkoutFlight,
  bookFlight,
  listFlightBookings,
  getFlightBookingDetails,
  cancelFlightBooking,
};
