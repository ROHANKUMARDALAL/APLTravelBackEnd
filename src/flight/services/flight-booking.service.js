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

function quoteFlightPrice(dto, fare) {
  const currency = fare.price.currency;
  const catalog = flightAddOnCatalog(currency);
  const seats = sumSelected(catalog.seats, dto.addOns?.seats || [], 'seat');
  const baggage = sumSelected(catalog.baggage, dto.addOns?.baggage || [], 'baggage');
  const meals = sumSelected(catalog.meals, dto.addOns?.meals || [], 'meal');
  const payableTravellers = Math.max(1, dto.travellers.length);
  const baseAmount = fare.price.amount * payableTravellers;
  const addonsAmount = seats.amount + baggage.amount + meals.amount;
  const selectedAddOns = [...seats.selected, ...baggage.selected, ...meals.selected];
  return {
    currency,
    baseAmount,
    addonsAmount,
    amount: baseAmount + addonsAmount,
    selectedAddOns,
  };
}

async function checkoutFlight(dto) {
  const details = await getFlightDetails(dto);
  await revalidateFlightOffer(dto);

  const fare = details.selectedFlightFareData;
  if (!fare) {
    throw AppError.validation('selectedFlightFareData missing — pass aplFareId');
  }

  const quote = quoteFlightPrice(dto, fare);
  assertExactPrice(quote, dto.confirmPrice);

  return createCheckoutSession({
    productType: 'FLIGHT',
    searchId: dto.searchId,
    aplOfferId: fare.aplFareId,
    aplEntityId: details.aplFlightId,
    contact: dto.contact,
    travellers: dto.travellers,
    pricing: {
      amount: quote.amount,
      currency: quote.currency,
      baseAmount: quote.baseAmount,
      addonsAmount: quote.addonsAmount,
    },
    offerSnapshot: {
      aplFlightId: details.aplFlightId,
      aplFareId: fare.aplFareId,
      flight: details.flight,
      flightFareData: fare,
      fareRules: details.fareRules,
      addOns: quote.selectedAddOns,
    },
  });
}

async function bookFlight(dto, user) {
  return confirmBookingFromCheckout({ ...dto, user });
}

async function listFlightBookings(userId) {
  return listBookingsByProduct('FLIGHT', userId);
}

async function getFlightBookingDetails(body, user) {
  return getBookingDetailsByProduct({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'FLIGHT',
    userId: user._id,
  });
}

async function cancelFlightBooking(body, user) {
  return cancelBooking({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'FLIGHT',
    userId: user._id,
  });
}

module.exports = {
  checkoutFlight,
  bookFlight,
  listFlightBookings,
  getFlightBookingDetails,
  cancelFlightBooking,
};
