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

async function checkoutHotel(dto) {
  const details = await getHotelDetails(dto);
  await revalidateHotelOffer(dto);

  const room = details.selectedRoom;
  if (!room) {
    throw AppError.validation('selectedRoom missing — pass aplRoomId');
  }

  const quote = quoteHotelPrice(dto, room);
  assertExactPrice(quote, dto.confirmPrice);

  return createCheckoutSession({
    productType: 'HOTEL',
    searchId: dto.searchId,
    aplOfferId: room.aplRoomId,
    aplEntityId: details.aplHotelId,
    contact: dto.contact,
    travellers: dto.guests,
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
      selectedRoom: room,
      policies: details.policies,
      addOns: quote.selectedAddOns,
    },
  });
}

async function bookHotel(dto, user) {
  return confirmBookingFromCheckout({ ...dto, user });
}

async function listHotelBookings(userId) {
  return listBookingsByProduct('HOTEL', userId);
}

async function getHotelBookingDetails(body, user) {
  return getBookingDetailsByProduct({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'HOTEL',
    userId: user._id,
  });
}

async function cancelHotelBooking(body, user) {
  return cancelBooking({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'HOTEL',
    userId: user._id,
  });
}

module.exports = {
  checkoutHotel,
  bookHotel,
  listHotelBookings,
  getHotelBookingDetails,
  cancelHotelBooking,
};
