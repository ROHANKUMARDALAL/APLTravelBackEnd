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
