'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireLogin } = require('../../common/middleware/require-login');
const { sendSuccess } = require('../../common/response/envelope');
const {
  getBookingByRef,
  cancelBooking,
  listBookingsForCustomer,
  claimRecordedBooking,
} = require('../../common/services/checkout-booking.service');
const { AppError } = require('../../common/errors/app-error');
const {
  requireTransactionTenant,
} = require('../../tenant/middleware/require-transaction-tenant');

const router = express.Router();

// Phase 9: booking ops resolve trusted website tenant (legacy bookings without dsaId still readable).
router.post(
  '/coupon-check',
  requireTransactionTenant,
  asyncHandler(async (req, res) => {
    const { loadEngineCoupon, quoteStoredCoupon } = require('../../pricing/services/coupon.service');
    const serviceCode = String(req.body?.serviceCode || '').toLowerCase();
    const customerId = req.user?._id;
    if (req.body?.searchId) {
      const quoted = await quoteStoredCoupon({
        dsaId: req.tenant?.dsaId,
        serviceCode,
        code: req.body?.code,
        customerId,
        searchId: req.body.searchId,
        offerId: req.body.offerId,
        passengers: req.body.passengers,
      });
      return sendSuccess(res, {
        coupon: {
          code: quoted.coupon.code,
          name: quoted.coupon.name,
          adjustmentType: quoted.coupon.adjustmentType,
          value: quoted.coupon.value,
          maxAmount: quoted.coupon.maxAmount ?? null,
        },
        quote: quoted.breakdown,
      });
    }
    const loaded = await loadEngineCoupon({
      dsaId: req.tenant?.dsaId,
      serviceCode,
      code: req.body?.code,
      customerId,
    });
    return sendSuccess(res, {
      coupon: {
        code: loaded.coupon.code,
        name: loaded.coupon.name,
        adjustmentType: loaded.coupon.adjustmentType,
        value: loaded.coupon.value,
        maxAmount: loaded.coupon.maxAmount,
        exclusive: loaded.coupon.exclusive,
      },
    });
  }),
);

router.post(
  '/payment-fee',
  requireTransactionTenant,
  asyncHandler(async (req, res) => {
    const { quotePaymentFee } = require('../../payments/payment-method-fee');
    const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
    const { resolveChargeAmount } = require('../../payments/services/payment.service');
    const CheckoutSession = require('../../common/database/models/CheckoutSession');
    let base = Number(req.body?.amount);
    let currency = String(req.body?.currency || 'INR').toUpperCase();
    if (req.body?.checkoutToken) {
      const session = await CheckoutSession.findOne({ checkoutToken: req.body.checkoutToken });
      if (!session) throw AppError.validation('Invalid checkoutToken');
      if (session.status === 'PAYING' || session.status === 'BOOKED') {
        throw AppError.validation('Payment method cannot be changed for this checkout');
      }
      const baseCharge = resolveChargeAmount(session);
      if (req.body?.amount != null && Number(req.body.amount) !== baseCharge.amount) {
        throw AppError.validation('Payment amount does not match the checkout', [
          { requiredAmount: baseCharge.amount, providedAmount: Number(req.body.amount) },
        ]);
      }
      base = baseCharge.amount;
      currency = baseCharge.currency;
    }
    let quote;
    try {
      quote = quotePaymentFee(base, req.body?.method);
    } catch (error) {
      throw AppError.validation(error.message || 'Unsupported payment method');
    }
    await writeLifecycleLog({
      stage: 'FEE_RECALCULATED',
      service: String(req.body?.service || 'CHECKOUT').toUpperCase(),
      operation: 'PAYMENT_FEE',
      businessOperation: 'PAYMENT',
      direction: 'INBOUND',
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      status: 'SUCCESS',
      request: {
        method: req.body?.method,
        amount: base,
        currency,
        checkoutToken: req.body?.checkoutToken || null,
      },
      result: quote,
    });
    return sendSuccess(res, { currency, ...quote });
  }),
);

router.get(
  '/',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await listBookingsForCustomer(req.user, { tenant: req.tenant }));
  }),
);

router.post(
  '/claim',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await claimRecordedBooking(req.user, req.body || {}));
  }),
);

router.post(
  '/cancel',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await cancelBooking({
        bookingId: req.body?.bookingId || req.body?.aplBookingRef,
        userId: req.user._id,
        tenant: req.tenant,
        reason: req.body?.reason,
        requestId: req.requestId,
        idempotencyKey: req.body?.idempotencyKey,
      }),
    );
  }),
);

router.get(
  '/:aplBookingRef',
  requireLogin,
  asyncHandler(async (req, res) => {
    const ref = req.params.aplBookingRef;
    if (!ref || !ref.startsWith('APL-BK-')) {
      throw AppError.validation('Invalid booking reference');
    }
    return sendSuccess(
      res,
      await getBookingByRef(ref, req.user._id, { tenant: req.tenant }),
    );
  }),
);

module.exports = router;
