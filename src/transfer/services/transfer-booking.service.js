'use strict';

const { assertExactPrice } = require('../../common/utils/price-confirm');
const {
  getTransferDetails,
  revalidateTransferOffer,
} = require('./transfer-search.service');
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

async function checkoutTransfer(dto, context = {}) {
  const details = await getTransferDetails(dto, context);
  await revalidateTransferOffer(dto, context);

  const transfer = details.transfer;
  const offer = details.selectedOffer;

  const pricingContext = await createPricingContext({
    dsaId: context.tenant?.dsaId || null,
    serviceCode: 'transfer',
  });

  // Prefer internal supplier price when present (revalidate/details may still hold it
  // on unsanitized Search docs). Public path uses customer price already priced.
  const supplierUnit = offer.supplierPrice || {
    amount: Number(offer.price?.amount) || 0,
    currency: offer.price?.currency || 'INR',
  };

  const priced = offer.supplierPrice
    ? calculatePrice({
        supplierPrice: supplierUnit,
        supplierCode: offer.supplier || null,
        context: pricingContext,
        includeInternal: true,
      })
    : {
        customerPrice: offer.price,
        supplierPrice: supplierUnit,
        commercialSnapshot: {
          finalPrice: offer.price,
          supplierNet: supplierUnit,
          pricingVersion: pricingContext.pricingVersion || '12.0',
          appliedRules: [],
        },
      };

  const quote = {
    currency: priced.customerPrice.currency,
    amount: priced.customerPrice.amount,
    baseAmount: priced.customerPrice.amount,
  };
  assertExactPrice(quote, dto.confirmPrice);

  return createCheckoutSession({
    productType: 'TRANSFER',
    searchId: dto.searchId,
    aplOfferId: offer.aplOfferId,
    aplEntityId: transfer.aplTransferId,
    dsaId: context.tenant?.dsaId,
    requestId: context.requestId,
    contact: dto.contact,
    travellers: dto.travellers,
    commercialSnapshot: {
      ...priced.commercialSnapshot,
      totalAmount: quote.amount,
    },
    pricing: {
      amount: quote.amount,
      currency: quote.currency,
      baseAmount: quote.baseAmount,
    },
    offerSnapshot: {
      aplTransferId: transfer.aplTransferId,
      aplOfferId: offer.aplOfferId,
      transferType: transfer.transferType,
      vehicleCategory: transfer.vehicleCategory,
      vehicleName: transfer.vehicleName,
      maxPassengers: transfer.maxPassengers,
      maxLuggage: transfer.maxLuggage,
      estimatedDurationMinutes: transfer.estimatedDurationMinutes,
      inclusions: transfer.inclusions,
      pickup: transfer.pickup,
      dropoff: transfer.dropoff,
      pickupDateTime: transfer.pickupDateTime,
      supplier: offer.supplier,
      supplierServiceId: offer.supplierServiceId,
      supplierPrice: priced.supplierPrice,
      customerPrice: priced.customerPrice,
      flightNumber: dto.flightNumber || null,
      pickupInstructions: dto.pickupInstructions || null,
      mock: true,
    },
  });
}

async function bookTransfer(dto, user, context = {}) {
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

async function listTransferBookings(userId, context = {}) {
  return listBookingsByProduct('TRANSFER', userId, { tenant: context.tenant });
}

async function getTransferBookingDetails(body, user, context = {}) {
  return getBookingDetailsByProduct({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'TRANSFER',
    userId: user._id,
    tenant: context.tenant,
  });
}

async function cancelTransferBooking(body, user, context = {}) {
  return cancelBooking({
    bookingId: body.bookingId || body.aplBookingRef,
    productType: 'TRANSFER',
    userId: user._id,
    tenant: context.tenant,
    reason: body.reason,
    requestId: context.requestId,
    idempotencyKey: body.idempotencyKey,
  });
}

module.exports = {
  checkoutTransfer,
  bookTransfer,
  listTransferBookings,
  getTransferBookingDetails,
  cancelTransferBooking,
};
