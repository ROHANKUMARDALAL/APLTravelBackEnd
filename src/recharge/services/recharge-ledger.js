'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');
const { Booking, Payment } = require('../../common/database/models/Booking');
const { bookingClock } = require('../../common/utils/booking-time');
const User = require('../../user/models/User');
const Refund = require('../../payments/models/Refund');
const { RefundStatus } = require('../../payments/status');
const {
  debitCustomerWalletForBooking,
  reverseCustomerWalletDebit,
} = require('../../wallet/customer-wallet-payment');

const SHORT_OPERATOR = {
  JIO: 'Jio',
  AIRTEL: 'Airtel',
  VI: 'Vi',
  BSNL: 'BSNL',
  MTNL: 'MTNL',
};

const CATEGORY_LABEL = {
  MOBILE: 'Mobile',
  BROADBAND: 'Broadband',
  ELECTRICITY: 'Electricity',
  GAS: 'Gas',
  METRO: 'Metro',
};

function transactionLabel(order, reversal = false) {
  const category = CATEGORY_LABEL[order.category] || 'Recharge';
  const operator = SHORT_OPERATOR[order.providerCode] || order.providerName || 'Recharge';
  const detail = `${category} — ${operator}`;
  return reversal ? `Recharge payment reversal (${detail})` : `Recharge Payment (${detail})`;
}

function bookingRefFor(order) {
  return `APL-BK-${String(order.reference || '').replace(/^APL-/, '')}`;
}

function serviceDetailsFor(order, label) {
  const plan = order.summary?.plan || {};
  const circle = order.summary?.circle || null;
  return {
    category: order.category,
    lineType: order.summary?.lineType || '',
    country: order.summary?.country || '',
    circleCode: circle?.code || '',
    circleName: circle?.name || '',
    operator: order.providerName || '',
    operatorCode: order.providerCode || '',
    planId: plan.id || '',
    validity: plan.validity || '',
    benefits: [plan.data, plan.calls, plan.sms].filter(Boolean).join('. '),
    description: plan.description || '',
    accountMasked: order.accountMasked || '',
    rechargeReference: order.reference,
    amount: order.amount,
    fulfillment: 'DEMO / MOCK RECHARGE',
    demo: true,
    telecomFulfilled: false,
    transactionLabel: label,
  };
}

async function ensureBooking({ order, context, quoted, outcome, label }) {
  const clientReference = `recharge:${order.reference}`;
  const existing = await Booking.findOne({ clientReference });
  if (existing) return existing;
  const user = context.userId
    ? await User.findById(context.userId).select('name email').lean()
    : null;
  const details = serviceDetailsFor(order, label);
  const clock = bookingClock(new Date(), order.currency);
  const payload = {
    aplBookingRef: bookingRefFor(order),
    clientReference,
    productType: 'RECHARGE',
    serviceCode: 'RECHARGE',
    status: outcome === 'SUCCESS' ? 'PENDING_PAYMENT' : 'FAILED',
    currency: order.currency,
    totalAmount: quoted.totalAmount,
    guestEmail: user?.email || undefined,
    guestPhone: order.accountMasked || undefined,
    customerName: user?.name || undefined,
    customerProfileId: context.userId ? String(context.userId) : undefined,
    userId: context.userId || undefined,
    dsaId: context.dsaId,
    supplierCode: 'APL_MOCK_RECHARGE',
    requestId: context.requestId || undefined,
    journeyId: order.journeyId,
    bookedAtUtc: clock.bookedAtUtc,
    timeZone: clock.timeZone,
    bookedAtLocal: clock.bookedAtLocal,
    paymentSummary: {
      method: quoted.method,
      provider: 'APL_MOCK_PAY',
      status: outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      feeAmount: quoted.feeAmount,
      baseAmount: quoted.baseAmount,
      totalAmount: quoted.totalAmount,
      simulated: true,
    },
    serviceDetails: details,
    services: { recharge: details },
    items: [{
      productType: 'RECHARGE',
      aplEntityId: details.planId || order.reference,
      supplierCode: 'APL_MOCK_RECHARGE',
      supplierBookingStatus: 'NOT_STARTED',
      amount: order.amount,
      currency: order.currency,
      snapshot: details,
    }],
  };
  try {
    return await Booking.create(payload);
  } catch (error) {
    if (error && error.code === 11000) {
      const winner = await Booking.findOne({ clientReference });
      if (winner) return winner;
    }
    throw error;
  }
}

async function ensurePayment({ order, booking, context, quoted, outcome, paymentRef }) {
  const idempotencyKey = `recharge-pay:${order.reference}`;
  const existing = await Payment.findOne({ idempotencyKey });
  const status = outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
  if (existing) {
    if (existing.status !== status && existing.status !== 'REFUNDED') {
      existing.status = status;
      existing.bookingConfirmStatus = outcome === 'SUCCESS' ? 'CONFIRMED' : 'FAILED';
      existing.failureReason = outcome === 'SUCCESS' ? undefined : 'Mock card declined';
      await existing.save();
    }
    return existing;
  }
  try {
    return await Payment.create({
      paymentRef,
      bookingId: booking._id,
      dsaId: context.dsaId,
      userId: context.userId || undefined,
      requestId: context.requestId || undefined,
      idempotencyKey,
      status,
      amount: quoted.totalAmount,
      currency: order.currency,
      provider: 'APL_MOCK_PAY',
      method: quoted.method,
      last4: quoted.last4 || undefined,
      failureReason: outcome === 'SUCCESS' ? undefined : 'Mock card declined',
      bookingConfirmStatus: outcome === 'SUCCESS' ? 'CONFIRMED' : 'FAILED',
      providerMeta: {
        simulated: true,
        telecomFulfilled: false,
        fulfillment: 'DEMO / MOCK RECHARGE',
        baseAmount: quoted.baseAmount,
        feeAmount: quoted.feeAmount,
        rechargeReference: order.reference,
      },
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const winner = await Payment.findOne({ idempotencyKey });
      if (winner) return winner;
    }
    throw error;
  }
}

async function projectRechargePayment({ order, context, quoted, outcome }) {
  const label = transactionLabel(order, false);
  let paymentRef = order.summary?.payment?.paymentRef;
  if (!paymentRef) {
    paymentRef = `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    order.summary = {
      ...order.summary,
      payment: { ...(order.summary?.payment || {}), paymentRef },
    };
    order.markModified('summary');
    await order.save();
  }
  const booking = await ensureBooking({ order, context, quoted, outcome, label });
  if (outcome === 'SUCCESS' && quoted.method === 'WALLET') {
    if (!context.userId) throw AppError.unauthorized();
    try {
      await debitCustomerWalletForBooking({
        userId: context.userId,
        dsaId: context.dsaId,
        currency: order.currency,
        amount: quoted.totalAmount,
        paymentRef,
        bookingReference: booking.aplBookingRef,
        serviceCode: 'recharge',
        reason: label,
      });
    } catch (error) {
      const WalletTransaction = require('../../customer/models/WalletTransaction');
      const debit = await WalletTransaction.findOne({ reference: paymentRef, type: 'BOOKING_DEBIT' }).lean();
      if (!debit) {
        order.status = 'VALIDATED';
        const summary = { ...(order.summary || {}) };
        delete summary.payment;
        delete summary.lock;
        order.summary = summary;
        order.markModified('summary');
        await order.save();
      }
      throw error;
    }
  }
  const payment = await ensurePayment({ order, booking, context, quoted, outcome, paymentRef });
  const status = outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
  await Booking.updateOne(
    { _id: booking._id },
    {
      $set: {
        status: outcome === 'SUCCESS' ? 'CONFIRMED' : 'FAILED',
        paymentSummary: {
          method: quoted.method,
          provider: 'APL_MOCK_PAY',
          status,
          paymentRef: payment.paymentRef,
          feeAmount: quoted.feeAmount,
          baseAmount: quoted.baseAmount,
          totalAmount: quoted.totalAmount,
          simulated: true,
        },
      },
    },
  );
  order.status = status;
  const summary = {
    ...order.summary,
    bookingReference: booking.aplBookingRef,
    dsaCode: booking.dsaCode || '',
    dsaName: booking.dsaName || '',
    transactionLabel: label,
    payment: {
      status: outcome === 'SUCCESS' ? 'APPROVED' : 'DECLINED',
      method: quoted.method,
      provider: 'APL_MOCK_PAY',
      simulated: true,
      feeAmount: quoted.feeAmount,
      totalAmount: quoted.totalAmount,
      paymentRef: payment.paymentRef,
      last4: quoted.last4,
      test: true,
    },
    receipt: {
      reference: order.reference,
      bookingReference: booking.aplBookingRef,
      paymentReference: payment.paymentRef,
      executedAt: new Date().toISOString(),
      test: true,
      fulfillment: 'DEMO / MOCK RECHARGE',
    },
  };
  delete summary.lock;
  order.summary = summary;
  order.markModified('summary');
  await order.save();
  return order;
}

async function refundRechargeOrder(order, context) {
  if (!order || order.status === 'REFUNDED' || order.summary?.payment?.status === 'REFUNDED') {
    return order;
  }
  if (order.status !== 'SUCCESS') throw AppError.validation('Only a completed demonstration recharge can be reversed');
  const paymentRef = order.summary?.payment?.paymentRef;
  const payment = paymentRef ? await Payment.findOne({ paymentRef, dsaId: context.dsaId, userId: context.userId }) : null;
  if (!payment) throw AppError.validation('No payment is linked to this recharge');
  const booking = await Booking.findOne({ aplBookingRef: order.summary.bookingReference, userId: context.userId });
  if (payment.method === 'WALLET') {
    await reverseCustomerWalletDebit({
      userId: context.userId,
      dsaId: context.dsaId,
      currency: order.currency,
      amount: payment.amount,
      paymentRef: payment.paymentRef,
      serviceCode: 'recharge',
      reason: transactionLabel(order, true),
    });
  }
  const refundRef = `${payment.paymentRef}:reversal`;
  const existingRefund = await Refund.findOne({ refundRef });
  if (!existingRefund && booking) {
    await Refund.create({
      refundRef,
      paymentId: payment._id,
      bookingId: booking._id,
      aplBookingRef: booking.aplBookingRef,
      dsaId: context.dsaId,
      userId: context.userId,
      idempotencyKey: `recharge-refund:${order.reference}`,
      kind: 'FULL',
      requestedAmount: payment.amount,
      approvedAmount: payment.amount,
      currency: order.currency,
      status: RefundStatus.SUCCESS,
      provider: 'APL_MOCK_PAY',
      reason: transactionLabel(order, true),
      providerMeta: { simulated: true, telecomFulfilled: false },
    });
  }
  payment.status = 'REFUNDED';
  await payment.save();
  if (booking) {
    await Booking.updateOne({ _id: booking._id }, { $set: { status: 'CANCELLED' } });
  }
  order.status = 'REFUNDED';
  order.summary = {
    ...order.summary,
    payment: { ...order.summary.payment, status: 'REFUNDED' },
  };
  order.markModified('summary');
  await order.save();
  return order;
}

module.exports = {
  transactionLabel,
  projectRechargePayment,
  refundRechargeOrder,
};
