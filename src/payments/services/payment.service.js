'use strict';

const crypto = require('crypto');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { getPaymentProvider } = require('../providers/registry');
const Payment = require('../models/Payment');
const { PaymentStatus, normalizePaymentStatus } = require('../status');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');

function newPaymentRef() {
  return `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

/**
 * Authoritative charge amount from checkout commercial snapshot / pricing.
 * Never trust client-sent payment.amount.
 */
function resolveChargeAmount(session) {
  const snap = session.commercialSnapshot || {};
  const finalPrice = snap.finalPrice || {};
  const amount =
    Number(finalPrice.amount ?? session.pricing?.amount);
  const currency = String(
    finalPrice.currency || session.pricing?.currency || 'INR',
  ).toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) {
    throw AppError.validation('Checkout has no authoritative charge amount');
  }
  return { amount, currency };
}

/**
 * Reject client-supplied payment.amount when it disagrees with the snapshot.
 */
function assertNoClientAmountTamper(session, paymentInput = {}) {
  if (paymentInput.amount == null && paymentInput.currency == null) return;
  const required = resolveChargeAmount(session);
  if (
    paymentInput.amount != null &&
    Number(paymentInput.amount) !== required.amount
  ) {
    throw AppError.validation(
      `Payment amount mismatch. Required amount is ${required.amount} ${required.currency}`,
      [
        {
          field: 'payment.amount',
          requiredAmount: required.amount,
          providedAmount: Number(paymentInput.amount),
          currency: required.currency,
        },
      ],
    );
  }
  if (
    paymentInput.currency != null &&
    String(paymentInput.currency).toUpperCase() !== required.currency
  ) {
    throw AppError.validation('Payment currency mismatch', [
      {
        field: 'payment.currency',
        required: required.currency,
        provided: String(paymentInput.currency).toUpperCase(),
      },
    ]);
  }
}

function toPublicPayment(doc) {
  if (!doc) return null;
  const status = normalizePaymentStatus(doc.status);
  return {
    paymentRef: doc.paymentRef || null,
    status,
    legacyStatus: doc.status,
    amount: doc.amount,
    currency: doc.currency,
    provider: doc.provider,
    providerRef: doc.providerRef || null,
    method: doc.method || null,
    last4: doc.last4 || null,
    bookingConfirmStatus: doc.bookingConfirmStatus || 'NOT_STARTED',
    needsAttention: Boolean(doc.needsAttention),
    failureReason: doc.failureReason || null,
    requestId: doc.requestId || null,
    dsaId: doc.dsaId ? String(doc.dsaId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Capture payment via provider adapter (mock today).
 * Idempotent on idempotencyKey.
 */
async function capturePayment({
  session,
  user,
  paymentInput = {},
  idempotencyKey,
  requestId,
  providerCode = 'APL_MOCK_PAY',
}) {
  assertNoClientAmountTamper(session, paymentInput);
  const { amount, currency } = resolveChargeAmount(session);
  const key =
    idempotencyKey ||
    `pay:${session.checkoutToken}:${user?._id || 'anon'}`;

  const existing = await Payment.findOne({ idempotencyKey: key });
  if (existing) {
    return {
      payment: existing,
      duplicate: true,
      public: toPublicPayment(existing),
    };
  }

  const paymentRef = newPaymentRef();
  let paymentDoc;
  try {
    paymentDoc = await Payment.create({
      paymentRef,
      checkoutToken: session.checkoutToken,
      dsaId: session.dsaId || undefined,
      userId: user?._id,
      requestId: requestId || session.requestId || undefined,
      idempotencyKey: key,
      status: PaymentStatus.CREATED,
      amount,
      currency,
      provider: providerCode,
      method: String(paymentInput.method || 'CARD').toUpperCase(),
      bookingConfirmStatus: 'NOT_STARTED',
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const raced = await Payment.findOne({ idempotencyKey: key });
      if (raced) {
        return {
          payment: raced,
          duplicate: true,
          public: toPublicPayment(raced),
        };
      }
    }
    throw err;
  }

  await writeLifecycleLog({
    stage: 'PAYMENT_CREATED',
    service: String(session.productType || 'FLIGHT').toLowerCase(),
    operation: 'PAYMENT_CAPTURE',
    requestId: paymentDoc.requestId,
    dsaId: paymentDoc.dsaId,
    userId: paymentDoc.userId,
    status: 'SUCCESS',
    result: {
      paymentRef: paymentDoc.paymentRef,
      amount,
      currency,
      provider: providerCode,
    },
  });

  const provider = getPaymentProvider(providerCode);
  const result = await provider.createPayment({
    amount,
    currency,
    method: paymentDoc.method,
    instrument: {
      cardNumber: paymentInput.cardNumber,
      upiId: paymentInput.upiId,
    },
    metadata: { paymentRef, checkoutToken: session.checkoutToken },
  });

  paymentDoc.status = result.status;
  paymentDoc.providerRef = result.providerRef || undefined;
  paymentDoc.last4 = result.last4 || undefined;
  paymentDoc.failureReason = result.failureReason || undefined;
  paymentDoc.providerMeta = result.providerMeta || {};
  await paymentDoc.save();

  await writeLifecycleLog({
    stage: result.ok ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
    service: String(session.productType || 'FLIGHT').toLowerCase(),
    operation: 'PAYMENT_CAPTURE',
    requestId: paymentDoc.requestId,
    dsaId: paymentDoc.dsaId,
    userId: paymentDoc.userId,
    status: result.ok ? 'SUCCESS' : 'FAILED',
    errorMessage: result.failureReason,
    result: {
      paymentRef: paymentDoc.paymentRef,
      status: paymentDoc.status,
      providerRef: paymentDoc.providerRef,
      // Never log card numbers / CVV
      method: paymentDoc.method,
      last4: paymentDoc.last4,
    },
  });

  if (!result.ok) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      result.failureReason || 'Payment failed',
      {
        httpStatus: 402,
        details: [
          {
            paymentStatus: normalizePaymentStatus(paymentDoc.status),
            paymentRef: paymentDoc.paymentRef,
          },
        ],
      },
    );
  }

  if (paymentDoc.status === PaymentStatus.PENDING) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Payment is still pending (mock FORCE_PENDING)',
      {
        httpStatus: 402,
        details: [
          {
            paymentStatus: PaymentStatus.PENDING,
            paymentRef: paymentDoc.paymentRef,
          },
        ],
      },
    );
  }

  return {
    payment: paymentDoc,
    duplicate: false,
    public: toPublicPayment(paymentDoc),
  };
}

function isSuccessfulPaymentStatus(status) {
  const n = normalizePaymentStatus(status);
  return n === PaymentStatus.SUCCESS;
}

module.exports = {
  resolveChargeAmount,
  assertNoClientAmountTamper,
  capturePayment,
  toPublicPayment,
  isSuccessfulPaymentStatus,
  newPaymentRef,
  normalizePaymentStatus,
};
