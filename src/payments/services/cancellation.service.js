'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');
const { getPaymentProvider } = require('../providers/registry');
const Payment = require('../models/Payment');
const CancellationRequest = require('../models/CancellationRequest');
const Refund = require('../models/Refund');
const {
  CancellationStatus,
  RefundStatus,
  PaymentStatus,
  normalizePaymentStatus,
} = require('../status');
const { calculateRefund } = require('./refund-calc.service');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const AccountAction = require('../../user/models/AccountAction');
const User = require('../../user/models/User');

function newCancellationRef() {
  return `CXL-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function newRefundRef() {
  return `RFD-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

/**
 * Mock supplier cancellation adapter boundary.
 * Real supplier cancel will plug in here later (Phase 11B+).
 */
async function mockSupplierCancel({ booking: _booking, forceFail = false }) {
  if (forceFail) {
    return {
      ok: false,
      status: 'FAILED',
      failureReason: 'Forced mock supplier cancellation failure',
    };
  }
  return {
    ok: true,
    status: 'CONFIRMED',
    supplierCancellationRef: `MOCKCXL-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`,
    note: 'Mock supplier cancellation — not a real airline/hotel confirm',
  };
}

function toPublicCancellation(doc) {
  if (!doc) return null;
  return {
    cancellationRef: doc.cancellationRef,
    status: doc.status,
    reason: doc.reason || '',
    requestedBy: doc.requestedBy,
    supplierCancellationRef: doc.supplierCancellationRef || null,
    failureReason: doc.failureReason || null,
    requestId: doc.requestId || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicRefund(doc) {
  if (!doc) return null;
  const customerStatus =
    doc.status === RefundStatus.SUCCESS
      ? 'COMPLETED'
      : doc.status === RefundStatus.FAILED
        ? 'FAILED'
        : doc.status === RefundStatus.PENDING || doc.status === RefundStatus.REQUESTED
          ? 'PROCESSING'
          : doc.status;
  return {
    refundRef: doc.refundRef,
    status: doc.status,
    customerStatus,
    kind: doc.kind,
    requestedAmount: doc.requestedAmount,
    approvedAmount: doc.approvedAmount,
    currency: doc.currency,
    provider: doc.provider,
    providerRefundRef: doc.providerRefundRef || null,
    reason: doc.reason || '',
    failureReason: doc.failureReason || null,
    requestId: doc.requestId || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function findOpenCancellation(bookingId) {
  return CancellationRequest.findOne({
    bookingId,
    status: {
      $in: [CancellationStatus.REQUESTED, CancellationStatus.PROCESSING],
    },
  }).sort({ createdAt: -1 });
}

/**
 * Full cancel → mock supplier cancel → refund calc → mock refund.
 * Idempotent on bookingId for already-cancelled / in-flight requests.
 */
async function processCancellation({
  booking,
  userId,
  reason = '',
  requestedBy = 'CUSTOMER',
  requestId,
  idempotencyKey,
  refundKind = 'FULL',
  requestedAmount,
  forceSupplierFail = false,
  forceRefundFail = false,
}) {
  if (booking.status === 'CANCELLED') {
    const existingCxl = await CancellationRequest.findOne({
      bookingId: booking._id,
      status: CancellationStatus.CONFIRMED,
    }).sort({ createdAt: -1 });
    const existingRefund = existingCxl?.refundId
      ? await Refund.findById(existingCxl.refundId)
      : await Refund.findOne({ bookingId: booking._id }).sort({ createdAt: -1 });
    const payment = await Payment.findOne({ bookingId: booking._id }).sort({
      createdAt: -1,
    });
    return {
      duplicate: true,
      booking,
      cancellation: existingCxl,
      refund: existingRefund,
      payment,
      public: {
        bookingId: booking.aplBookingRef,
        productType: booking.productType,
        bookingStatus: booking.status,
        paymentStatus: payment
          ? normalizePaymentStatus(payment.status)
          : 'UNKNOWN',
        cancellation: toPublicCancellation(existingCxl),
        refund: toPublicRefund(existingRefund),
        refundedAmount: existingRefund?.approvedAmount ?? 0,
        currency: booking.currency,
      },
    };
  }

  if (booking.status !== 'CONFIRMED') {
    throw AppError.validation(
      `Booking cannot be cancelled from status ${booking.status}`,
    );
  }

  const key =
    idempotencyKey || `cancel:${booking.aplBookingRef}:${userId || 'sys'}`;

  const byKey = await CancellationRequest.findOne({ idempotencyKey: key });
  if (byKey) {
    const refund = byKey.refundId
      ? await Refund.findById(byKey.refundId)
      : null;
    const payment = await Payment.findOne({ bookingId: booking._id }).sort({
      createdAt: -1,
    });
    return {
      duplicate: true,
      booking,
      cancellation: byKey,
      refund,
      payment,
      public: {
        bookingId: booking.aplBookingRef,
        productType: booking.productType,
        bookingStatus: booking.status,
        paymentStatus: payment
          ? normalizePaymentStatus(payment.status)
          : 'UNKNOWN',
        cancellation: toPublicCancellation(byKey),
        refund: toPublicRefund(refund),
        refundedAmount: refund?.approvedAmount ?? 0,
        currency: booking.currency,
      },
    };
  }

  const open = await findOpenCancellation(booking._id);
  if (open) {
    throw AppError.validation(
      'A cancellation request is already in progress for this booking',
      [{ cancellationRef: open.cancellationRef, status: open.status }],
    );
  }

  let cancellation;
  try {
    cancellation = await CancellationRequest.create({
      cancellationRef: newCancellationRef(),
      bookingId: booking._id,
      aplBookingRef: booking.aplBookingRef,
      dsaId: booking.dsaId || undefined,
      userId: userId || booking.userId || undefined,
      requestedBy,
      reason: String(reason || '').slice(0, 1000),
      status: CancellationStatus.REQUESTED,
      requestId: requestId || undefined,
      idempotencyKey: key,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const raced = await CancellationRequest.findOne({ idempotencyKey: key });
      if (raced) {
        return processCancellation({
          booking,
          userId,
          reason,
          requestedBy,
          requestId,
          idempotencyKey: key,
        });
      }
    }
    throw err;
  }

  await writeLifecycleLog({
    stage: 'CANCELLATION_REQUESTED',
    service: String(booking.productType || 'FLIGHT').toLowerCase(),
    operation: 'CANCELLATION',
    requestId: cancellation.requestId,
    dsaId: cancellation.dsaId,
    userId: cancellation.userId,
    status: 'SUCCESS',
    result: {
      cancellationRef: cancellation.cancellationRef,
      aplBookingRef: booking.aplBookingRef,
    },
  });

  cancellation.status = CancellationStatus.PROCESSING;
  await cancellation.save();

  const supplierResult = await mockSupplierCancel({
    booking,
    forceFail: forceSupplierFail,
  });

  if (!supplierResult.ok) {
    cancellation.status = CancellationStatus.FAILED;
    cancellation.failureReason = supplierResult.failureReason;
    cancellation.supplierStatus = supplierResult.status;
    await cancellation.save();
    await writeLifecycleLog({
      stage: 'CANCELLATION_FAILED',
      service: String(booking.productType || 'FLIGHT').toLowerCase(),
      operation: 'CANCELLATION',
      requestId: cancellation.requestId,
      dsaId: cancellation.dsaId,
      userId: cancellation.userId,
      status: 'FAILED',
      errorMessage: supplierResult.failureReason,
      result: { cancellationRef: cancellation.cancellationRef },
    });
    throw AppError.validation(
      supplierResult.failureReason || 'Supplier cancellation failed',
      [{ cancellationRef: cancellation.cancellationRef }],
    );
  }

  cancellation.supplierCancellationRef =
    supplierResult.supplierCancellationRef;
  cancellation.supplierStatus = supplierResult.status;
  cancellation.status = CancellationStatus.CONFIRMED;
  await cancellation.save();

  booking.status = 'CANCELLED';
  for (const item of booking.items || []) {
    item.supplierBookingStatus = 'CANCELLED';
  }
  await booking.save();

  await writeLifecycleLog({
    stage: 'CANCELLATION_CONFIRMED',
    service: String(booking.productType || 'FLIGHT').toLowerCase(),
    operation: 'CANCELLATION',
    requestId: cancellation.requestId,
    dsaId: cancellation.dsaId,
    userId: cancellation.userId,
    status: 'SUCCESS',
    result: {
      cancellationRef: cancellation.cancellationRef,
      supplierCancellationRef: cancellation.supplierCancellationRef,
      mock: true,
    },
  });

  const payment = await Payment.findOne({ bookingId: booking._id }).sort({
    createdAt: -1,
  });

  const calc = calculateRefund({
    booking,
    kind: refundKind,
    requestedAmount,
  });
  if (!calc.ok) {
    throw AppError.validation(calc.error);
  }

  let refund = null;
  if (
    payment &&
    (normalizePaymentStatus(payment.status) === PaymentStatus.SUCCESS ||
      payment.status === 'CAPTURED' ||
      payment.status === 'AUTHORIZED')
  ) {
    refund = await executeRefund({
      booking,
      payment,
      cancellation,
      calc,
      requestId: cancellation.requestId,
      reason: forceRefundFail ? 'FORCE_REFUND_FAIL' : reason,
      userId,
    });
    cancellation.refundId = refund._id;
    await cancellation.save();
  }

  const user = userId ? await User.findById(userId) : null;
  if (user && refund?.status === RefundStatus.SUCCESS) {
    if (booking.currency === user.currency) {
      user.balance += refund.approvedAmount;
      await user.save();
    }
    await AccountAction.create({
      userId,
      type: 'CANCELLATION',
      direction: 'NONE',
      aplBookingRef: booking.aplBookingRef,
      productType: booking.productType,
      amount: refund.approvedAmount,
      currency: booking.currency,
      balanceAfter: user.balance,
      paymentStatus: PaymentStatus.REFUNDED,
      note: 'Booking cancelled (mock supplier)',
    });
    await AccountAction.create({
      userId,
      type: 'REFUND',
      direction: 'CREDIT',
      aplBookingRef: booking.aplBookingRef,
      productType: booking.productType,
      amount: refund.approvedAmount,
      currency: booking.currency,
      balanceAfter: user.balance,
      paymentStatus:
        refund.status === RefundStatus.SUCCESS
          ? PaymentStatus.REFUNDED
          : refund.status,
      note:
        booking.currency === user.currency
          ? 'Refund credited to wallet balance (mock)'
          : 'Refund recorded; wallet currency does not match booking currency',
    });
  }

  return {
    duplicate: false,
    booking,
    cancellation,
    refund,
    payment,
    public: {
      bookingId: booking.aplBookingRef,
      productType: booking.productType,
      bookingStatus: booking.status,
      paymentStatus: payment
        ? normalizePaymentStatus(payment.status)
        : 'UNKNOWN',
      cancellation: toPublicCancellation(cancellation),
      refund: toPublicRefund(refund),
      refundedAmount: refund?.approvedAmount ?? 0,
      currency: booking.currency,
      balance: user ? user.balance : undefined,
      mockNote:
        'Supplier cancellation and refund used mock adapters — not a real airline refund quote.',
    },
  };
}

async function executeRefund({
  booking,
  payment,
  cancellation,
  calc,
  requestId,
  reason,
  userId,
}) {
  const idempotencyKey = `refund:${booking.aplBookingRef}:${cancellation.cancellationRef}`;

  const existing = await Refund.findOne({ idempotencyKey });
  if (existing) return existing;

  let refund;
  try {
    refund = await Refund.create({
      refundRef: newRefundRef(),
      paymentId: payment._id,
      bookingId: booking._id,
      cancellationId: cancellation._id,
      aplBookingRef: booking.aplBookingRef,
      dsaId: booking.dsaId || undefined,
      userId: userId || booking.userId || undefined,
      requestId: requestId || undefined,
      idempotencyKey,
      kind: calc.kind,
      requestedAmount: calc.requestedAmount,
      approvedAmount: calc.approvedAmount,
      currency: calc.currency,
      status: RefundStatus.REQUESTED,
      provider: payment.provider || 'APL_MOCK_PAY',
      reason: String(reason || '').slice(0, 1000),
      breakdown: calc.breakdown,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return Refund.findOne({ idempotencyKey });
    }
    throw err;
  }

  payment.status = PaymentStatus.REFUND_PENDING;
  await payment.save();

  await writeLifecycleLog({
    stage: 'REFUND_REQUESTED',
    service: String(booking.productType || 'FLIGHT').toLowerCase(),
    operation: 'REFUND',
    requestId: refund.requestId,
    dsaId: refund.dsaId,
    userId: refund.userId,
    status: 'SUCCESS',
    result: {
      refundRef: refund.refundRef,
      approvedAmount: refund.approvedAmount,
      currency: refund.currency,
      kind: refund.kind,
    },
  });

  refund.status = RefundStatus.PENDING;
  await refund.save();

  const provider = getPaymentProvider(payment.provider || 'APL_MOCK_PAY');
  const result = await provider.refundPayment({
    amount: refund.approvedAmount,
    currency: refund.currency,
    providerRef: payment.providerRef,
    reason: refund.reason,
  });

  if (!result.ok) {
    refund.status = RefundStatus.FAILED;
    refund.failureReason = result.failureReason;
    await refund.save();
    // Keep payment as REFUND_PENDING — recoverable state
    payment.needsAttention = true;
    await payment.save();
    await writeLifecycleLog({
      stage: 'REFUND_FAILED',
      service: String(booking.productType || 'FLIGHT').toLowerCase(),
      operation: 'REFUND',
      requestId: refund.requestId,
      dsaId: refund.dsaId,
      userId: refund.userId,
      status: 'FAILED',
      errorMessage: result.failureReason,
      result: { refundRef: refund.refundRef },
    });
    return refund;
  }

  refund.status = RefundStatus.SUCCESS;
  refund.providerRefundRef = result.providerRefundRef;
  refund.providerMeta = result.providerMeta || {};
  await refund.save();

  payment.status =
    calc.kind === 'PARTIAL'
      ? PaymentStatus.PARTIALLY_REFUNDED
      : PaymentStatus.REFUNDED;
  payment.needsAttention = false;
  await payment.save();

  await writeLifecycleLog({
    stage: 'REFUND_SUCCESS',
    service: String(booking.productType || 'FLIGHT').toLowerCase(),
    operation: 'REFUND',
    requestId: refund.requestId,
    dsaId: refund.dsaId,
    userId: refund.userId,
    status: 'SUCCESS',
    result: {
      refundRef: refund.refundRef,
      providerRefundRef: refund.providerRefundRef,
      approvedAmount: refund.approvedAmount,
    },
  });

  return refund;
}

module.exports = {
  processCancellation,
  executeRefund,
  toPublicCancellation,
  toPublicRefund,
  mockSupplierCancel,
  calculateRefund,
};
