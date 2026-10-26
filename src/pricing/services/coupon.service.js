'use strict';

const { mongoose } = require('../../common/database/connection');
const { AppError } = require('../../common/errors/app-error');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const { Booking } = require('../../common/database/models/Booking');
const { createPricingContext, calculatePrice } = require('./pricing-engine.service');
const { toMinor, toMajor, percentOfMinor } = require('../money');

const FARE_FAMILY_MULTIPLIER = {
  SAVER: 1,
  PUBLISH: 1.08,
  FLEXI: 1.18,
  CORPORATE: 1.26,
};

const MESSAGES = {
  INVALID: 'Invalid coupon',
  EXPIRED: 'Coupon expired',
  SERVICE: 'Coupon not applicable to this service',
  MINIMUM: 'Minimum booking amount not met',
  MARGIN: 'This coupon cannot reduce the fare any further.',
  LIMIT: 'Coupon usage limit reached',
  CUSTOMER: 'Coupon not eligible for this customer',
  USED: 'Coupon already used',
  COMBINE: 'Coupon cannot be combined with the current discount',
  INACTIVE: 'Invalid coupon',
};

function customerKeyOf(customerId) {
  return customerId ? String(customerId) : 'guest';
}

function engineInput(coupon) {
  return {
    code: coupon.code,
    adjustmentType: coupon.adjustmentType,
    value: coupon.value,
    currency: coupon.currency || 'INR',
    maxAmount: coupon.maxAmount,
    minAmount: coupon.minAmount,
    exclusive: coupon.exclusive,
  };
}

function publicBreakdown(priced) {
  const snap = priced.commercialSnapshot;
  const fare = snap.supplierPrice.amount + snap.aplMarkup.amount + snap.dsaMarkup.amount + snap.serviceFee.amount;
  return {
    currency: snap.currency,
    fare,
    additionalCharges: snap.dsaMarkup.amount + snap.serviceFee.amount,
    discount: snap.discount.amount,
    couponSavings: snap.coupon?.amount || 0,
    couponAdjustmentType: snap.coupon?.adjustmentType || null,
    couponValue: snap.coupon?.value ?? null,
    couponMaxAmount: snap.coupon?.maxAmount ?? null,
    discountAdjustmentType: snap.discount?.adjustmentType || null,
    discountValue: snap.discount?.value ?? null,
    discountMaxAmount: snap.discount?.maxAmount ?? null,
    total: snap.finalPrice.amount,
    couponStatus: snap.coupon?.status || null,
  };
}

async function findCoupon(dsaId, serviceCode, code) {
  if (!mongoose.isValidObjectId(String(dsaId || ''))) throw AppError.forbidden('DSA context required');
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw AppError.validation(MESSAGES.INVALID);
  return Coupon.findOne({
    dsaId,
    code: normalized,
    archivedAt: null,
  }).lean();
}

async function assertEligible(coupon, { serviceCode, customerId, at = new Date() }) {
  if (!coupon || coupon.status === 'INACTIVE') throw AppError.validation(MESSAGES.INVALID);
  if (String(coupon.serviceCode) !== String(serviceCode || '').toLowerCase()) {
    throw AppError.validation(MESSAGES.SERVICE);
  }
  if (coupon.status === 'EXPIRED' || (coupon.endsAt && new Date(coupon.endsAt) < at) || (coupon.startsAt && new Date(coupon.startsAt) > at)) {
    throw AppError.validation(MESSAGES.EXPIRED);
  }
  if (coupon.totalLimit != null && coupon.usedCount >= coupon.totalLimit) {
    throw AppError.validation(MESSAGES.LIMIT);
  }
  if (Array.isArray(coupon.customerIds) && coupon.customerIds.length && !coupon.customerIds.includes(String(customerId || ''))) {
    throw AppError.validation(MESSAGES.CUSTOMER);
  }
  const key = customerKeyOf(customerId);
  const personal = await CouponRedemption.countDocuments({
    couponId: coupon._id,
    customerKey: key,
    status: { $in: ['RESERVED', 'CONSUMED'] },
  });
  if (personal >= (coupon.perCustomerLimit || 1)) throw AppError.validation(MESSAGES.USED);
  if (coupon.firstBookingOnly && customerId) {
    const prior = await Booking.countDocuments({ dsaId: coupon.dsaId, userId: customerId, status: { $nin: ['FAILED', 'CANCELLED'] } });
    if (prior > 0) throw AppError.validation(MESSAGES.CUSTOMER);
  }
  return coupon;
}

async function priceWithCoupon({ dsaId, serviceCode, code, supplierPrice, customerId, tripType, originCode, destinationCode }) {
  const coupon = await findCoupon(dsaId, serviceCode, code);
  await assertEligible(coupon, { serviceCode, customerId });
  const pricingContext = await createPricingContext({
    dsaId,
    serviceCode,
    customerId,
    tripType,
    originCode,
    destinationCode,
  });
  pricingContext.coupon = engineInput(coupon);
  const priced = calculatePrice({
    supplierPrice,
    context: pricingContext,
    includeInternal: true,
  });
  if (priced.commercialSnapshot.coupon?.status === 'COUPON_CANNOT_COMBINE') {
    throw AppError.validation(MESSAGES.COMBINE);
  }
  if (priced.commercialSnapshot.coupon?.status === 'COUPON_MINIMUM_NOT_MET') {
    throw AppError.validation(MESSAGES.MINIMUM);
  }
  if (priced.commercialSnapshot.coupon?.status === 'COUPON_NO_REMAINING_MARGIN') {
    throw AppError.validation(MESSAGES.MARGIN);
  }
  return { coupon, priced, breakdown: publicBreakdown(priced) };
}

async function reserveCoupon({ coupon, customerId, idempotencyKey }) {
  const key = String(idempotencyKey || '');
  if (!key) throw AppError.validation('Checkout reference is required');
  const existing = await CouponRedemption.findOne({ idempotencyKey: key }).lean();
  if (existing) return existing;
  const limitFilter = coupon.totalLimit == null
    ? { _id: coupon._id, dsaId: coupon.dsaId, status: 'ACTIVE' }
    : { _id: coupon._id, dsaId: coupon.dsaId, status: 'ACTIVE', usedCount: { $lt: coupon.totalLimit } };
  const updated = await Coupon.findOneAndUpdate(limitFilter, { $inc: { usedCount: 1 } }, { new: true });
  if (!updated) throw AppError.validation(MESSAGES.LIMIT);
  try {
    return await CouponRedemption.create({
      couponId: coupon._id,
      dsaId: coupon.dsaId,
      customerKey: customerKeyOf(customerId),
      idempotencyKey: key,
      status: 'RESERVED',
    });
  } catch (error) {
    if (error?.code === 11000) {
      await Coupon.updateOne({ _id: coupon._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
      return CouponRedemption.findOne({ idempotencyKey: key }).lean();
    }
    await Coupon.updateOne({ _id: coupon._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    throw error;
  }
}

async function settleCoupon(idempotencyKey, status) {
  const redemption = await CouponRedemption.findOne({ idempotencyKey: String(idempotencyKey || '') });
  if (!redemption || redemption.status !== 'RESERVED') return null;
  if (status === 'CONSUMED') {
    redemption.status = 'CONSUMED';
    await redemption.save();
    return redemption;
  }
  redemption.status = 'RELEASED';
  await redemption.save();
  await Coupon.updateOne({ _id: redemption.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  return redemption;
}

async function loadEngineCoupon({ dsaId, serviceCode, code, customerId }) {
  const coupon = await findCoupon(dsaId, serviceCode, code);
  await assertEligible(coupon, { serviceCode, customerId });
  return { coupon, input: engineInput(coupon) };
}

function payingPassengers(request) {
  const source = request?.passengers || request || {};
  const adults = Number(source.adults ?? request?.adults ?? 1);
  const children = Number(source.children ?? request?.children ?? 0);
  return Math.max(1, (Number.isFinite(adults) ? adults : 1) + (Number.isFinite(children) ? children : 0));
}

function findFlightFare(results, offerId) {
  const wanted = String(offerId || '');
  if (!wanted) return null;
  for (const flight of results?.flights || []) {
    for (const fare of flight.flightFareData || []) {
      if (String(fare.aplFareId) === wanted) return { flight, fare };
    }
  }
  return null;
}

function familyUnitAmount(customerAmount, fareType) {
  const multiplier = FARE_FAMILY_MULTIPLIER[String(fareType || 'SAVER').toUpperCase()] || 1;
  return toMajor(Math.round(toMinor(customerAmount) * multiplier));
}

/**
 * Coupon is applied once to the selected family total (unit × paying passengers).
 * It is not priced against another family's supplier unit.
 */
function quoteFlightFamilyCoupon({ fare, priced, coupon, passengers = 1 }) {
  const snap = priced.commercialSnapshot;
  const currency = snap.currency || 'INR';
  const computedUnit = familyUnitAmount(snap.finalPrice.amount, fare?.fareType);
  const storedUnit = Number(fare?.price?.amount);
  const unit = Number.isFinite(storedUnit) && storedUnit > 0 ? storedUnit : computedUnit;
  const pax = Math.max(1, Number(passengers) || 1);
  const grossMinor = toMinor(unit) * pax;
  const floorMinor = (toMinor(snap.supplierPrice.amount) + toMinor(snap.aplMarkup.amount)) * pax;
  const roomMinor = Math.max(0, grossMinor - floorMinor);
  let couponMinor = 0;
  let couponStatus = null;
  if (coupon?.exclusive && Number(snap.discount?.amount) > 0) {
    couponStatus = 'COUPON_CANNOT_COMBINE';
  } else if (Number(coupon?.minAmount) > 0 && grossMinor < toMinor(coupon.minAmount)) {
    couponStatus = 'COUPON_MINIMUM_NOT_MET';
  } else if (
    String(coupon?.adjustmentType || '').toUpperCase() !== 'PERCENTAGE'
    && coupon?.currency
    && String(coupon.currency).toUpperCase() !== String(currency).toUpperCase()
  ) {
    couponStatus = 'COUPON_NO_REMAINING_MARGIN';
  } else {
    const requested = String(coupon?.adjustmentType || '').toUpperCase() === 'PERCENTAGE'
      ? percentOfMinor(grossMinor, coupon.value)
      : toMinor(coupon?.value || 0);
    const max = coupon?.maxAmount == null || coupon?.maxAmount === '' ? null : Number(coupon.maxAmount);
    const capped = Number.isFinite(max) && max > 0 ? Math.min(requested, toMinor(max)) : requested;
    couponMinor = Math.min(Math.max(0, capped), roomMinor, grossMinor);
    couponStatus = couponMinor > 0 ? 'APPLIED' : 'COUPON_NO_REMAINING_MARGIN';
  }
  return {
    currency,
    passengers: pax,
    unitAmount: toMajor(toMinor(unit)),
    fare: toMajor(grossMinor),
    additionalCharges: 0,
    discount: 0,
    couponSavings: toMajor(couponMinor),
    couponAdjustmentType: coupon?.adjustmentType || null,
    couponValue: coupon?.value ?? null,
    couponMaxAmount: coupon?.maxAmount ?? null,
    total: toMajor(grossMinor - couponMinor),
    couponStatus,
  };
}

function findSupplierPrice(serviceCode, results, offerId) {
  const wanted = offerId ? String(offerId) : '';
  const take = (price, id) => {
    if (!price || !Number.isFinite(Number(price.amount))) return null;
    if (wanted && id && String(id) !== wanted) return null;
    return { amount: Number(price.amount), currency: price.currency || 'INR' };
  };
  if (serviceCode === 'flight') {
    const located = findFlightFare(results, wanted);
    const price = located?.fare?.supplierPrice;
    if (price && Number.isFinite(Number(price.amount))) {
      return { amount: Number(price.amount), currency: price.currency || 'INR' };
    }
    return null;
  }
  if (serviceCode === 'hotel') {
    for (const hotel of results?.hotels || []) {
      for (const room of hotel.availableRooms || hotel.offers || []) {
        const price = take(room.supplierPrice, room.aplRoomId || room.aplOfferId);
        if (price && (!wanted || String(room.aplRoomId || room.aplOfferId || hotel.aplHotelId) === wanted)) return price;
      }
    }
  }
  if (serviceCode === 'bus') {
    for (const bus of results?.buses || []) {
      const offers = [...(bus.offers || []), bus.primaryOffer].filter(Boolean);
      for (const offer of offers) {
        const id = offer.aplOfferId || bus.aplBusId;
        const price = take(offer.supplierPrice, id);
        if (price && (!wanted || String(id) === wanted || String(bus.aplBusId) === wanted)) return price;
      }
    }
  }
  if (serviceCode === 'transfer') {
    for (const ride of results?.transfers || results?.offers || []) {
      const offers = ride.offers || [ride];
      for (const offer of offers) {
        const id = offer.aplOfferId || ride.aplTransferId;
        const price = take(offer.supplierPrice, id);
        if (price && (!wanted || String(id) === wanted || String(ride.aplTransferId) === wanted)) return price;
      }
    }
  }
  return null;
}

async function quoteStoredCoupon({ dsaId, serviceCode, code, customerId, searchId, offerId, passengers }) {
  const Search = require('../../common/database/models/Search');
  const doc = await Search.findOne({
    aplSearchId: String(searchId || ''),
    ...(dsaId ? { dsaId } : {}),
  }).select('results request').lean();
  if (!doc) throw AppError.validation('Search again before applying this coupon');
  const request = doc.request || {};
  if (serviceCode === 'flight') {
    const located = findFlightFare(doc.results, offerId);
    if (!located?.fare?.supplierPrice) throw AppError.validation('This offer is no longer available');
    const pricingContext = await createPricingContext({
      dsaId,
      serviceCode,
      customerId,
      tripType: request.tripType || null,
      originCode: request.originCityCode || request.originCode || null,
      destinationCode: request.destinationCityCode || request.destinationCode || null,
    });
    const priced = calculatePrice({
      supplierPrice: located.fare.supplierPrice,
      supplierCode: located.fare.supplier || null,
      context: pricingContext,
      includeInternal: true,
    });
    const coupon = await findCoupon(dsaId, serviceCode, code);
    await assertEligible(coupon, { serviceCode, customerId });
    const breakdown = quoteFlightFamilyCoupon({
      fare: located.fare,
      priced,
      coupon,
      passengers: Number(passengers) > 0 ? Number(passengers) : payingPassengers(request),
    });
    if (breakdown.couponStatus === 'COUPON_CANNOT_COMBINE') throw AppError.validation(MESSAGES.COMBINE);
    if (breakdown.couponStatus === 'COUPON_MINIMUM_NOT_MET') throw AppError.validation(MESSAGES.MINIMUM);
    if (breakdown.couponStatus === 'COUPON_NO_REMAINING_MARGIN') throw AppError.validation(MESSAGES.MARGIN);
    return { coupon, priced, breakdown };
  }
  const supplierPrice = findSupplierPrice(serviceCode, doc.results, offerId);
  if (!supplierPrice) throw AppError.validation('This offer is no longer available');
  return priceWithCoupon({
    dsaId,
    serviceCode,
    code,
    customerId,
    supplierPrice,
    tripType: request.tripType || null,
    originCode: request.originCityCode || request.originCode || null,
    destinationCode: request.destinationCityCode || request.destinationCode || null,
  });
}

module.exports = {
  MESSAGES,
  engineInput,
  publicBreakdown,
  priceWithCoupon,
  quoteStoredCoupon,
  quoteFlightFamilyCoupon,
  findFlightFare,
  payingPassengers,
  FARE_FAMILY_MULTIPLIER,
  loadEngineCoupon,
  reserveCoupon,
  settleCoupon,
};
