'use strict';

const { AppError } = require('../../common/errors/app-error');
const { assertExactPrice } = require('../../common/utils/price-confirm');
const {
  getBusDetails,
  revalidateBusOffer,
  findOfferOnBus,
} = require('./bus-search.service');
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

function pickPoint(points, code) {
  return (points || []).find((p) => String(p.code) === String(code)) || null;
}

async function checkoutBus(dto, context = {}) {
  const details = await getBusDetails(dto, context);
  await revalidateBusOffer(dto, context);

  const bus = details.bus;
  const offer = details.selectedOffer;
  const seatCount = dto.selectedSeats.length;
  if (seatCount > (offer.seatsLeft || 0)) {
    throw AppError.validation(
      `Only ${offer.seatsLeft} seats available; requested ${seatCount}`,
    );
  }

  const inventory = details.seatInventory;
  const taken = new Set(inventory.takenSeats || []);
  for (const seat of dto.selectedSeats) {
    if (taken.has(seat)) {
      throw AppError.validation(`Seat ${seat} is not available`);
    }
    if (!(inventory.availableSeats || []).includes(seat)) {
      throw AppError.validation(`Unknown seat: ${seat}`);
    }
  }

  const boarding = pickPoint(offer.boardingPoints, dto.boardingPointCode);
  const dropping = pickPoint(offer.droppingPoints, dto.droppingPointCode);
  if (!boarding) throw AppError.validation('Invalid boardingPointCode');
  if (!dropping) throw AppError.validation('Invalid droppingPointCode');

  const pricingContext = await createPricingContext({
    dsaId: context.tenant?.dsaId || null,
    serviceCode: 'bus',
  });
  const unitSupplier = offer.supplierPrice || {
    amount: Number(offer.price?.amount) || 0,
    currency: offer.price?.currency || 'INR',
  };
  const priced = calculatePrice({
    supplierPrice: {
      amount: unitSupplier.amount * seatCount,
      currency: unitSupplier.currency,
    },
    supplierCode: offer.supplier || null,
    context: pricingContext,
    includeInternal: true,
  });

  const quote = {
    currency: priced.customerPrice.currency,
    amount: priced.customerPrice.amount,
    baseAmount: priced.customerPrice.amount,
    unitAmount: unitSupplier.amount,
    seatCount,
  };
  assertExactPrice(quote, dto.confirmPrice);

  return createCheckoutSession({
    productType: 'BUS',
    searchId: dto.searchId,
    aplOfferId: offer.aplOfferId,
    aplEntityId: bus.aplBusId,
    dsaId: context.tenant?.dsaId,
    requestId: context.requestId,
    contact: dto.contact,
    travellers: dto.travellers,
    commercialSnapshot: {
      ...priced.commercialSnapshot,
      seatCount,
      unitSupplierAmount: unitSupplier.amount,
      totalAmount: quote.amount,
    },
    pricing: {
      amount: quote.amount,
      currency: quote.currency,
      baseAmount: quote.baseAmount,
      unitAmount: quote.unitAmount,
    },
    offerSnapshot: {
      aplBusId: bus.aplBusId,
      aplOfferId: offer.aplOfferId,
      operator: bus.operator,
      busType: bus.busType,
      travelDate: bus.travelDate,
      departure: bus.departure,
      arrival: bus.arrival,
      durationMinutes: bus.durationMinutes,
      amenities: bus.amenities,
      selectedSeats: dto.selectedSeats,
      boardingPoint: boarding,
      droppingPoint: dropping,
      supplier: offer.supplier,
      supplierServiceId: offer.supplierServiceId,
      supplierPrice: priced.supplierPrice,
      customerPrice: priced.customerPrice,
      seatInventoryNote: inventory.note,
      mock: true,
    },
  });
}

async function bookBus(dto, user, context = {}) {
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

async function listBusBookings(userId, context = {}) {
  return listBookingsByProduct('BUS', userId, { tenant: context.tenant });
}

async function getBusBookingDetails(body, user, context = {}) {
  return getBookingDetailsByProduct({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'BUS',
    userId: user._id,
    tenant: context.tenant,
  });
}

async function cancelBusBooking(body, user, context = {}) {
  return cancelBooking({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'BUS',
    userId: user._id,
    tenant: context.tenant,
    reason: body.reason,
    requestId: context.requestId,
    idempotencyKey: body.idempotencyKey,
  });
}

module.exports = {
  checkoutBus,
  bookBus,
  listBusBookings,
  getBusBookingDetails,
  cancelBusBooking,
  findOfferOnBus,
};
