'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireLogin } = require('../../common/middleware/require-login');
const { sendSuccess } = require('../../common/response/envelope');
const { toPublicUser } = require('../services/auth.service');
const AccountAction = require('../models/AccountAction');
const ServiceLog = require('../../common/database/models/ServiceLog');
const { Booking, Payment } = require('../../common/database/models/Booking');
const Refund = require('../../payments/models/Refund');
const CancellationRequest = require('../../payments/models/CancellationRequest');
const CustomerWallet = require('../../customer/models/CustomerWallet');
const WalletTransaction = require('../../customer/models/WalletTransaction');
const Search = require('../../common/database/models/Search');

const router = express.Router();

router.use(requireLogin);

function customerScope(req) {
  const scope = { userId: req.user._id };
  if (req.customerDsaId) scope.dsaId = req.customerDsaId;
  return scope;
}

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
    const scope = customerScope(req);
    const bookings = await Booking.find({
      ...scope,
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

router.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const scope = customerScope(req);
    const wallet = await CustomerWallet.findOne(scope).lean();
    const transactions = await WalletTransaction.find(scope).sort({ createdAt: -1 }).limit(50).lean();
    return sendSuccess(res, {
      currency: wallet?.currency || req.user.currency || 'INR',
      balance: wallet ? wallet.balance : 0,
      transactions: transactions.map((row) => ({
        id: String(row._id),
        amount: row.amount,
        direction: row.direction,
        type: row.type,
        currency: row.currency,
        reason: row.reason || '',
        reference: row.reference || '',
        balanceAfter: row.balanceAfter,
        createdAt: row.createdAt,
      })),
    });
  }),
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const scope = customerScope(req);
    const [payments, refunds, cancellations] = await Promise.all([
      Payment.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
      Refund.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
      CancellationRequest.find(scope).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return sendSuccess(res, {
      payments: payments.map((row) => ({
        reference: row.paymentRef || String(row._id),
        status: row.status,
        amount: row.amount,
        currency: row.currency,
      })),
      refunds: refunds.map((row) => ({
        reference: row.refundRef || String(row._id),
        status: row.status,
        amount: row.amount,
        currency: row.currency,
      })),
      cancellations: cancellations.map((row) => ({
        reference: row.aplBookingRef || String(row._id),
        status: row.status,
      })),
    });
  }),
);

router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const scope = customerScope(req);
    const [bookings, searches] = await Promise.all([
      Booking.find(scope).sort({ createdAt: -1 }).limit(30).select('aplBookingRef status createdAt').lean(),
      Search.find({ ...scope }).sort({ createdAt: -1 }).limit(20).select('aplSearchId service createdAt').lean(),
    ]);
    const refs = bookings.map((row) => row.aplBookingRef).filter(Boolean);
    const actions = refs.length
      ? await AccountAction.find({ userId: req.user._id, aplBookingRef: { $in: refs } })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean()
      : [];
    return sendSuccess(res, {
      bookings: bookings.map((row) => ({ reference: row.aplBookingRef, status: row.status, at: row.createdAt })),
      searches: searches.map((row) => ({ reference: row.aplSearchId, service: row.service, at: row.createdAt })),
      actions: actions.map((row) => ({ type: row.type, reference: row.aplBookingRef, amount: row.amount, at: row.createdAt })),
    });
  }),
);

router.get(
  '/referral',
  asyncHandler(async (req, res) => {
    return sendSuccess(res, {
      referralCode: req.customerMembership?.referralCode || '',
    });
  }),
);

module.exports = router;
