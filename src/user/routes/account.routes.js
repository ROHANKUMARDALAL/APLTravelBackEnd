'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireLogin } = require('../../common/middleware/require-login');
const { sendSuccess } = require('../../common/response/envelope');
const { toPublicUser } = require('../services/auth.service');
const AccountAction = require('../models/AccountAction');
const ServiceLog = require('../../common/database/models/ServiceLog');
const { Booking } = require('../../common/database/models/Booking');

const router = express.Router();

router.use(requireLogin);

router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.query.requestId) filter.requestId = String(req.query.requestId);
    if (req.query.searchId) filter.searchId = String(req.query.searchId);
    if (req.query.service) filter.service = String(req.query.service).toUpperCase();
    const logs = await ServiceLog.find(filter).sort({ createdAt: -1 }).limit(50);
    return sendSuccess(res, {
      count: logs.length,
      logs: logs.map((log) => ({
        requestId: log.requestId,
        direction: log.direction,
        service: log.service,
        operation: log.operation,
        supplierCode: log.supplierCode || null,
        searchId: log.searchId || null,
        httpStatus: log.httpStatus,
        durationMs: log.durationMs,
        request: log.request,
        supplierRequest: log.supplierRequest || null,
        result: log.result,
        errorCode: log.errorCode || null,
        errorMessage: log.errorMessage || null,
        createdAt: log.createdAt,
      })),
    });
  }),
);

router.get(
  '/balance',
  asyncHandler(async (req, res) => {
    return sendSuccess(res, {
      userId: String(req.user._id),
      currency: req.user.currency,
      balance: req.user.balance,
    });
  }),
);

router.get(
  '/actions',
  asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.query.type) {
      filter.type = String(req.query.type).toUpperCase();
    }
    const actions = await AccountAction.find(filter).sort({ createdAt: -1 }).limit(100);
    return sendSuccess(res, {
      user: toPublicUser(req.user),
      count: actions.length,
      actions: actions.map((action) => ({
        type: action.type,
        direction: action.direction,
        bookingId: action.aplBookingRef,
        productType: action.productType,
        amount: action.amount,
        currency: action.currency,
        balanceAfter: action.balanceAfter,
        paymentMethod: action.paymentMethod,
        paymentStatus: action.paymentStatus,
        note: action.note,
        createdAt: action.createdAt,
      })),
    });
  }),
);

router.get(
  '/cancellations',
  asyncHandler(async (req, res) => {
    const bookings = await Booking.find({
      userId: req.user._id,
      status: 'CANCELLED',
    })
      .sort({ updatedAt: -1 })
      .limit(100);
    return sendSuccess(res, {
      count: bookings.length,
      cancellations: bookings.map((booking) => ({
        bookingId: booking.aplBookingRef,
        productType: booking.productType,
        bookingStatus: booking.status,
        totalAmount: booking.totalAmount,
        currency: booking.currency,
        cancelledAt: booking.updatedAt,
      })),
    });
  }),
);

module.exports = router;
