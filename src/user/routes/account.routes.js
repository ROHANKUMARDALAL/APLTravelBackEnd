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

function moneyStatus(status) {
  const value = String(status || '').toUpperCase();
  if (['SUCCESS', 'CAPTURED', 'AUTHORIZED'].includes(value)) return 'success';
  if (['CREATED', 'PENDING', 'REFUND_PENDING'].includes(value)) return 'pending';
  if (['FAILED', 'CANCELLED'].includes(value)) return 'failed';
  if (['REFUNDED', 'PARTIALLY_REFUNDED'].includes(value)) return 'refunded';
  return 'pending';
}

function maskedMethod(method, last4) {
  const name = String(method || 'Payment').toUpperCase();
  if (last4) return `${name} •••• ${String(last4).slice(-4)}`;
  return name;
}

router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const scope = customerScope(req);
    const [payments, refunds, walletRows, wallet] = await Promise.all([
      Payment.find(scope).sort({ createdAt: -1 }).limit(200).lean(),
      Refund.find(scope).sort({ createdAt: -1 }).limit(200).lean(),
      WalletTransaction.find(scope).sort({ createdAt: -1 }).limit(200).lean(),
      CustomerWallet.findOne(scope).lean(),
    ]);
    const bookingIds = [
      ...payments.map((row) => row.bookingId),
      ...refunds.map((row) => row.bookingId),
    ].filter(Boolean);
    const bookings = bookingIds.length
      ? await Booking.find({ _id: { $in: bookingIds }, userId: req.user._id }).select('aplBookingRef productType').lean()
      : [];
    const bookingById = new Map(bookings.map((row) => [String(row._id), row]));
    const paymentRefs = new Set(payments.map((row) => row.paymentRef).filter(Boolean));
    const refundRefs = new Set(refunds.map((row) => row.refundRef).filter(Boolean));
    const rows = [];

    for (const row of payments) {
      const booking = bookingById.get(String(row.bookingId)) || null;
      const view = moneyStatus(row.status);
      const settled = view === 'success' || view === 'refunded';
      rows.push({
        id: row.paymentRef || String(row._id),
        reference: row.paymentRef || String(row._id),
        bookingReference: booking?.aplBookingRef || null,
        service: booking?.productType || 'BOOKING',
        type: 'Booking payment',
        amount: Number(row.amount || 0),
        currency: row.currency || 'INR',
        direction: settled ? 'DEBIT' : null,
        method: maskedMethod(row.method, row.last4),
        status: view,
        createdAt: row.createdAt,
      });
    }

    for (const row of refunds) {
      const booking = bookingById.get(String(row.bookingId)) || null;
      const raw = String(row.status || '').toUpperCase();
      const view = raw === 'SUCCESS' ? 'success' : raw === 'FAILED' ? 'failed' : 'pending';
      rows.push({
        id: row.refundRef || String(row._id),
        reference: row.refundRef || String(row._id),
        bookingReference: booking?.aplBookingRef || null,
        service: booking?.productType || 'BOOKING',
        type: 'Refund',
        amount: Number(row.approvedAmount ?? row.requestedAmount ?? 0),
        currency: row.currency || 'INR',
        direction: view === 'success' ? 'CREDIT' : null,
        method: 'Refund',
        status: view === 'success' ? 'refunded' : view,
        createdAt: row.createdAt,
      });
    }

    for (const row of walletRows) {
      const reference = String(row.reference || '');
      if (reference && (paymentRefs.has(reference) || refundRefs.has(reference))) continue;
      const credit = row.direction === 'CREDIT';
      rows.push({
        id: String(row._id),
        reference: reference || String(row._id),
        bookingReference: null,
        service: 'WALLET',
        type: row.type || (credit ? 'Wallet credit' : 'Wallet debit'),
        amount: Number(row.amount || 0),
        currency: row.currency || 'INR',
        direction: row.direction,
        method: 'Customer wallet',
        status: 'success',
        createdAt: row.createdAt,
      });
    }

    rows.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const summary = {
      totalPaid: 0,
      totalCredits: 0,
      totalDebits: 0,
      pending: 0,
      failed: 0,
      walletBalance: wallet ? Number(wallet.balance) : 0,
      currency: wallet?.currency || req.user.currency || 'INR',
    };
    for (const row of rows) {
      if (row.status === 'pending') summary.pending += 1;
      if (row.status === 'failed') summary.failed += 1;
      if (row.direction === 'CREDIT' && (row.status === 'success' || row.status === 'refunded')) {
        summary.totalCredits += row.amount;
      }
      if (row.direction === 'DEBIT' && (row.status === 'success' || row.status === 'refunded')) {
        summary.totalDebits += row.amount;
        if (row.type === 'Booking payment' && row.status === 'success') summary.totalPaid += row.amount;
      }
    }
    const service = String(req.query.service || '').toUpperCase();
    const status = String(req.query.status || '').toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();
    const from = req.query.from ? Date.parse(String(req.query.from)) : null;
    const to = req.query.to ? Date.parse(String(req.query.to)) : null;
    const filtered = rows.filter((row) => {
      if (service && row.service !== service) return false;
      if (status && row.status !== status && row.direction?.toLowerCase() !== status) return false;
      if (q && !`${row.reference} ${row.bookingReference || ''} ${row.service} ${row.type}`.toLowerCase().includes(q)) return false;
      const at = Date.parse(row.createdAt || 0);
      if (Number.isFinite(from) && at < from) return false;
      if (Number.isFinite(to) && at > to + 86400000) return false;
      return true;
    });
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
    const start = (page - 1) * limit;
    return sendSuccess(res, {
      summary,
      page,
      limit,
      total: filtered.length,
      transactions: filtered.slice(start, start + limit),
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
