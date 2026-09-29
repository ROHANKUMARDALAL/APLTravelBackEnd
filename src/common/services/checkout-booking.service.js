'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { AppError, ErrorCode } = require('../errors/app-error');
const { assertExactPrice } = require('../utils/price-confirm');
const {
  formatAplBookingRef,
} = require('../utils/apl-ids');
const CheckoutSession = require('../database/models/CheckoutSession');
const { Booking, Payment } = require('../database/models/Booking');
const AccountAction = require('../../user/models/AccountAction');
const User = require('../../user/models/User');

/**
 * Shared checkout + mock booking (MMT/Paytm-style token flow).
 * 1) checkout → checkoutToken
 * 2) book with checkoutToken + mock payment
 */

async function createCheckoutSession({
  productType,
  searchId,
  aplOfferId,
  aplEntityId,
  offerSnapshot,
  pricing,
  contact,
  travellers,
}) {
  const checkoutToken = `chk_${uuidv4().replace(/-/g, '')}`;
  const session = await CheckoutSession.create({
    checkoutToken,
    productType,
    searchId,
    aplOfferId,
    aplEntityId,
    status: 'READY',
    contact,
    travellers,
    offerSnapshot,
    pricing,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  return {
    checkoutToken: session.checkoutToken,
    productType,
    searchId,
    aplOfferId,
    status: session.status,
    pricing: session.pricing,
    travellersCount: travellers.length,
    contact,
    expiresAt: session.expiresAt.toISOString(),
    nextStep: 'POST /api/v1/{flights|hotels}/book with checkoutToken + payment',
  };
}

function simulateMockPayment(payment) {
  const method = payment.method;
  if (method === 'CARD') {
    const digits = String(payment.cardNumber || '').replace(/\D/g, '');
    if (digits.endsWith('0000')) {
      return {
        ok: false,
        status: 'FAILED',
        message: 'Mock card declined (cards ending in 0000 fail)',
      };
    }
    return {
      ok: true,
      status: 'CAPTURED',
      providerRef: `MOCKPAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      last4: digits.slice(-4) || '4242',
    };
  }
  if (method === 'UPI') {
    if (!payment.upiId || !String(payment.upiId).includes('@')) {
      return { ok: false, status: 'FAILED', message: 'Invalid UPI id' };
    }
    return {
      ok: true,
      status: 'CAPTURED',
      providerRef: `MOCKUPI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      last4: undefined,
    };
  }
  // NETBANKING / WALLET etc. — always succeed in mock
  return {
    ok: true,
    status: 'CAPTURED',
    providerRef: `MOCKPAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
  };
}

async function confirmBookingFromCheckout({ checkoutToken, payment, confirmPrice, user }) {
  if (!user?._id) {
    throw AppError.unauthorized('Login token is required to book');
  }
  const session = await CheckoutSession.findOne({ checkoutToken });
  if (!session) {
    throw AppError.notFound('Invalid checkoutToken');
  }
  if (session.status === 'BOOKED') {
    throw AppError.validation('This checkoutToken was already used for a booking');
  }
  if (session.expiresAt < new Date() || session.status === 'EXPIRED') {
    session.status = 'EXPIRED';
    await session.save();
    throw AppError.validation('Checkout session expired. Start checkout again.');
  }

  assertExactPrice(
    {
      amount: session.pricing.amount,
      currency: session.pricing.currency,
    },
    confirmPrice,
  );

  if (payment.method === 'WALLET') {
    if (user.currency !== session.pricing.currency) {
      throw AppError.validation(
        `Wallet currency ${user.currency} does not match booking currency ${session.pricing.currency}`,
      );
    }
    if (user.balance < session.pricing.amount) {
      throw AppError.validation('Insufficient wallet balance', [
        { balance: user.balance, requiredAmount: session.pricing.amount, currency: user.currency },
      ]);
    }
  }

  const payResult = simulateMockPayment(payment);
  if (!payResult.ok) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, payResult.message, {
      httpStatus: 402,
      details: [{ paymentStatus: payResult.status }],
    });
  }

  const aplBookingRef = formatAplBookingRef(
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
  const supplierCode = session.offerSnapshot?.supplier || 'TBO';
  const supplierBookingRef = `PNR${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const booking = await Booking.create({
    aplBookingRef,
    userId: user._id,
    customerProfileId: String(user._id),
    productType: session.productType,
    status: 'CONFIRMED',
    currency: session.pricing.currency,
    totalAmount: session.pricing.amount,
    guestEmail: session.contact.email,
    guestPhone: session.contact.phone,
    checkoutToken,
    searchId: session.searchId,
    travellers: session.travellers,
    items: [
      {
        productType: session.productType,
        aplEntityId: session.aplEntityId,
        aplOfferId: session.aplOfferId,
        supplierCode,
        supplierBookingRef,
        supplierBookingStatus: 'CONFIRMED',
        amount: session.pricing.amount,
        currency: session.pricing.currency,
        snapshot: session.offerSnapshot,
      },
    ],
  });

  const paymentDoc = await Payment.create({
    bookingId: booking._id,
    status: payResult.status,
    amount: session.pricing.amount,
    currency: session.pricing.currency,
    provider: 'APL_MOCK_PAY',
    providerRef: payResult.providerRef,
    method: payment.method,
    last4: payResult.last4,
  });

  session.status = 'BOOKED';
  session.aplBookingRef = aplBookingRef;
  await session.save();

  if (payment.method === 'WALLET') {
    user.balance -= session.pricing.amount;
    await user.save();
  }

  await AccountAction.create({
    userId: user._id,
    type: 'PAYMENT',
    direction: 'DEBIT',
    aplBookingRef,
    productType: session.productType,
    amount: session.pricing.amount,
    currency: session.pricing.currency,
    balanceAfter: user.balance,
    paymentMethod: payment.method,
    paymentStatus: payResult.status,
    note:
      payment.method === 'WALLET'
        ? 'Wallet payment captured'
        : 'External payment captured',
  });

  return {
    aplBookingRef,
    bookingStatus: booking.status,
    paymentStatus: paymentDoc.status,
    status: booking.status,
    productType: booking.productType,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    travellers: booking.travellers,
    items: booking.items.map((i) => ({
      productType: i.productType,
      aplEntityId: i.aplEntityId,
      aplOfferId: i.aplOfferId,
      supplierCode: i.supplierCode,
      supplierBookingRef: i.supplierBookingRef,
      supplierBookingStatus: i.supplierBookingStatus,
      amount: i.amount,
      currency: i.currency,
    })),
    payment: {
      status: paymentDoc.status,
      provider: paymentDoc.provider,
      providerRef: paymentDoc.providerRef,
      method: paymentDoc.method,
      last4: paymentDoc.last4,
      amount: paymentDoc.amount,
      currency: paymentDoc.currency,
    },
    balance: user.balance,
    offer: session.offerSnapshot,
  };
}

async function getBookingByRef(aplBookingRef, userId) {
  const filter = { aplBookingRef };
  if (userId) filter.userId = userId;
  const booking = await Booking.findOne(filter);
  if (!booking) throw AppError.notFound(`Booking not found: ${aplBookingRef}`);
  const payment = await Payment.findOne({ bookingId: booking._id }).sort({
    createdAt: -1,
  });
  return {
    aplBookingRef: booking.aplBookingRef,
    bookingStatus: booking.status,
    paymentStatus: payment ? payment.status : 'PENDING',
    status: booking.status,
    productType: booking.productType,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    travellers: booking.travellers,
    items: booking.items,
    payment: payment
      ? {
          status: payment.status,
          provider: payment.provider,
          providerRef: payment.providerRef,
          method: payment.method,
          last4: payment.last4,
          amount: payment.amount,
          currency: payment.currency,
        }
      : null,
    createdAt: booking.createdAt,
  };
}

function bookingCard(booking, payment) {
  const item = booking.items?.[0];
  const snap = item?.snapshot || {};
  let title = booking.productType;
  if (booking.productType === 'FLIGHT') {
    const dep = snap.flight?.departure?.airport || snap.flight?.departure?.cityCode;
    const arr = snap.flight?.arrival?.airport || snap.flight?.arrival?.cityCode;
    title = [snap.flight?.airline, snap.flight?.flightNumber, dep && arr ? `${dep}-${arr}` : null]
      .filter(Boolean)
      .join(' ');
  } else if (booking.productType === 'HOTEL') {
    title = [snap.hotel?.name, snap.selectedRoom?.roomName].filter(Boolean).join(' · ');
  }
  return {
    bookingId: booking.aplBookingRef,
    productType: booking.productType,
    bookingStatus: booking.status,
    paymentStatus: payment ? payment.status : 'PENDING',
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    title: title || booking.aplBookingRef,
    guestEmail: booking.guestEmail,
    createdAt: booking.createdAt,
  };
}

async function latestPaymentsFor(bookings) {
  const payments = await Payment.find({
    bookingId: { $in: bookings.map((b) => b._id) },
  }).sort({ createdAt: -1 });
  const latest = new Map();
  for (const payment of payments) {
    const key = String(payment.bookingId);
    if (!latest.has(key)) latest.set(key, payment);
  }
  return latest;
}

async function listBookingsByProduct(productType, userId) {
  const bookings = await Booking.find({ productType, userId }).sort({ createdAt: -1 }).limit(100);
  const payments = await latestPaymentsFor(bookings);
  return {
    productType,
    count: bookings.length,
    bookings: bookings.map((booking) =>
      bookingCard(booking, payments.get(String(booking._id))),
    ),
  };
}

async function getBookingDetailsByProduct({ bookingId, productType, userId }) {
  if (!bookingId || typeof bookingId !== 'string' || !bookingId.startsWith('APL-BK-')) {
    throw AppError.validation('bookingId is required (APL-BK-...)');
  }
  const details = await getBookingByRef(bookingId, userId);
  if (details.productType !== productType) {
    throw AppError.notFound(`${productType} booking not found: ${bookingId}`);
  }
  return {
    bookingId: details.aplBookingRef,
    ...details,
  };
}

async function cancelBooking({ bookingId, userId, productType }) {
  if (!bookingId || typeof bookingId !== 'string' || !bookingId.startsWith('APL-BK-')) {
    throw AppError.validation('bookingId is required (APL-BK-...)');
  }
  const booking = await Booking.findOne({ aplBookingRef: bookingId, userId });
  if (!booking || (productType && booking.productType !== productType)) {
    throw AppError.notFound(`Booking not found: ${bookingId}`);
  }
  if (booking.status === 'CANCELLED') {
    throw AppError.validation('Booking is already cancelled');
  }
  if (booking.status !== 'CONFIRMED') {
    throw AppError.validation(`Booking cannot be cancelled from status ${booking.status}`);
  }

  booking.status = 'CANCELLED';
  for (const item of booking.items) {
    item.supplierBookingStatus = 'CANCELLED';
  }
  await booking.save();

  const payment = await Payment.findOne({ bookingId: booking._id }).sort({ createdAt: -1 });
  if (payment && payment.status === 'CAPTURED') {
    payment.status = 'REFUNDED';
    await payment.save();
  }

  const user = await User.findById(userId);
  if (user && booking.currency === user.currency) {
    user.balance += booking.totalAmount;
    await user.save();
  }

  await AccountAction.create({
    userId,
    type: 'CANCELLATION',
    direction: 'NONE',
    aplBookingRef: booking.aplBookingRef,
    productType: booking.productType,
    amount: booking.totalAmount,
    currency: booking.currency,
    balanceAfter: user ? user.balance : 0,
    paymentStatus: 'REFUNDED',
    note: 'Booking cancelled',
  });
  await AccountAction.create({
    userId,
    type: 'REFUND',
    direction: 'CREDIT',
    aplBookingRef: booking.aplBookingRef,
    productType: booking.productType,
    amount: booking.totalAmount,
    currency: booking.currency,
    balanceAfter: user ? user.balance : 0,
    paymentStatus: 'REFUNDED',
    note:
      user && booking.currency === user.currency
        ? 'Refund credited to wallet balance'
        : 'Refund recorded; wallet currency does not match booking currency',
  });

  return {
    bookingId: booking.aplBookingRef,
    productType: booking.productType,
    bookingStatus: booking.status,
    paymentStatus: 'REFUNDED',
    refundedAmount: booking.totalAmount,
    currency: booking.currency,
    balance: user ? user.balance : 0,
  };
}

module.exports = {
  createCheckoutSession,
  confirmBookingFromCheckout,
  getBookingByRef,
  listBookingsByProduct,
  getBookingDetailsByProduct,
  cancelBooking,
};
