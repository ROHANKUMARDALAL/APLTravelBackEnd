'use strict';

const { AppError } = require('../../common/errors/app-error');
const { assertExactPrice, sumSelected } = require('../../common/utils/price-confirm');
const { hotelExtraServices } = require('../data/extra-services');
const {
  getHotelDetails,
  revalidateHotelOffer,
} = require('./hotel-search.service');
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

function quoteHotelPrice(dto, room) {
  const currency = room.price.currency;
  const extras = sumSelected(
    hotelExtraServices(currency),
    dto.addOns?.extraServices || [],
    'extra service',
  );
  const guests = Math.max(1, Number(dto.guestCount) || dto.guests?.length || 1);
  const roomAmount = room.price.amount * guests;
  return {
    currency,
    baseAmount: roomAmount,
    addonsAmount: extras.amount,
    amount: roomAmount + extras.amount,
    selectedAddOns: extras.selected,
  };
}

async function checkoutHotel(dto, context = {}) {
  const details = await getHotelDetails(dto, context);
  await revalidateHotelOffer(dto, context);

  const room = details.selectedRoom;
  if (!room) {
    throw AppError.validation('selectedRoom missing — pass aplRoomId');
  }

  const pricingContext = await createPricingContext({
    dsaId: context.tenant?.dsaId || null,
    serviceCode: 'hotel',
  });
  const supplierPrice = room.supplierPrice || {
    amount: Number(room.price?.amount) || 0,
    currency: room.price?.currency || 'INR',
  };
  const priced = calculatePrice({
    supplierPrice,
    supplierCode: room.supplier || null,
    context: pricingContext,
    includeInternal: true,
  });
  const roomForQuote = {
    ...room,
    price: priced.customerPrice,
    supplierPrice: priced.supplierPrice,
    commercialSnapshot: priced.commercialSnapshot,
  };

  const quote = quoteHotelPrice(dto, roomForQuote);
  assertExactPrice(quote, dto.confirmPrice);

  return createCheckoutSession({
    productType: 'HOTEL',
    searchId: dto.searchId,
    aplOfferId: room.aplRoomId,
    aplEntityId: details.aplHotelId,
    dsaId: context.tenant?.dsaId,
    requestId: context.requestId,
    contact: dto.contact,
    travellers: dto.guests,
    commercialSnapshot: {
      ...priced.commercialSnapshot,
      addonsAmount: quote.addonsAmount,
      totalAmount: quote.amount,
    },
    pricing: {
      amount: quote.amount,
      currency: quote.currency,
      baseAmount: quote.baseAmount,
      addonsAmount: quote.addonsAmount,
    },
    offerSnapshot: {
      aplHotelId: details.aplHotelId,
      aplRoomId: room.aplRoomId,
      hotel: details.hotel,
      selectedRoom: roomForQuote,
      policies: details.policies,
      addOns: quote.selectedAddOns,
      supplier: room.supplier,
    },
  });
}

async function bookHotel(dto, user, context = {}) {
  return confirmBookingFromCheckout({
    checkoutToken: dto.checkoutToken,
    payment: dto.payment,
    confirmPrice: dto.confirmPrice,
    user,
    tenant: context.tenant,
    requestId: context.requestId,
    idempotencyKey: dto.idempotencyKey || dto.payment?.idempotencyKey,
    simulateBookingFailure: dto.simulateBookingFailure,
  });
}

async function listHotelBookings(userId, context = {}) {
  return listBookingsByProduct('HOTEL', userId, { tenant: context.tenant });
}

async function getHotelBookingDetails(body, user, context = {}) {
  return getBookingDetailsByProduct({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'HOTEL',
    userId: user._id,
    tenant: context.tenant,
  });
}

async function cancelHotelBooking(body, user, context = {}) {
  return cancelBooking({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'HOTEL',
    userId: user._id,
    tenant: context.tenant,
    reason: body.reason,
    requestId: context.requestId,
    idempotencyKey: body.idempotencyKey,
  });
}

module.exports = {
  checkoutHotel,
  bookHotel,
  listHotelBookings,
  getHotelBookingDetails,
  cancelHotelBooking,
};
