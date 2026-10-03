'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { AppError, ErrorCode } = require('../errors/app-error');
const { assertExactPrice } = require('../utils/price-confirm');
const {
  formatAplBookingRef,
} = require('../utils/apl-ids');
const CheckoutSession = require('../database/models/CheckoutSession');
const Search = require('../database/models/Search');
const { Booking, Payment } = require('../database/models/Booking');
const { bookingClock, serviceFolderName } = require('../utils/booking-time');
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

  const clock = bookingClock(new Date(), session.pricing.currency);
  const serviceName = serviceFolderName(session.productType);
  const items = [
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
  ];
  const serviceRecord = {
    aplBookingRef,
    status: 'CONFIRMED',
    currency: session.pricing.currency,
    totalAmount: session.pricing.amount,
    bookedAtUtc: clock.bookedAtUtc,
    bookedAtLocal: clock.bookedAtLocal,
    timeZone: clock.timeZone,
    guestEmail: session.contact.email,
    guestPhone: session.contact.phone,
    travellers: session.travellers,
    items,
  };

  const booking = await Booking.create({
    aplBookingRef,
    userId: user._id,
    customerProfileId: String(user._id),
    productType: session.productType,
    status: 'CONFIRMED',
    currency: session.pricing.currency,
    totalAmount: session.pricing.amount,
    bookedAtUtc: clock.bookedAtUtc,
    timeZone: clock.timeZone,
    bookedAtLocal: clock.bookedAtLocal,
    services: { [serviceName]: serviceRecord },
    guestEmail: session.contact.email,
    guestPhone: session.contact.phone,
    checkoutToken,
    searchId: session.searchId,
    travellers: session.travellers,
    items,
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
    bookedAtUtc: booking.bookedAtUtc,
    bookedAtLocal: booking.bookedAtLocal,
    timeZone: booking.timeZone,
    services: booking.services,
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
  let searchRequest = null;
  if (booking.searchId) {
    const search = await Search.findOne({ aplSearchId: booking.searchId }).select("request");
    searchRequest = search?.request || null;
  }
  const card = bookingCard(booking, payment, searchRequest);
  return {
    ...card,
    aplBookingRef: booking.aplBookingRef,
    status: booking.status,
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
  };
}

function clockParts(iso) {
  const value = String(iso || "");
  return {
    at: value,
    date: value.slice(0, 10),
    time: value.length >= 16 ? value.slice(11, 16) : "",
  };
}

function fareBreakdown(booking, fare, addOns) {
  const currency = booking.currency || fare?.currency || 'INR';
  const total = Number(booking.totalAmount) || 0;
  const extras = Array.isArray(addOns) ? addOns : [];
  const addOnItems = extras
    .map((item) => ({
      label: item.label || item.name || item.type || 'Add-on',
      amount: Number(item.amount ?? item.price?.amount ?? item.price) || 0,
    }))
    .filter((item) => item.label);
  const addOnTotal = addOnItems.reduce((sum, item) => sum + item.amount, 0);
  const taxes = Number(fare?.taxes) || 0;
  const statedBase = Number(fare?.base ?? fare?.amount);
  // Booked total is the source of truth for what the customer paid.
  let base = Number.isFinite(statedBase)
    ? statedBase
    : Math.max(0, total - taxes - addOnTotal);
  if (total > 0) {
    base = Math.max(0, total - taxes - addOnTotal);
  }
  return {
    currency,
    base,
    taxes,
    addOns: addOnTotal,
    addOnItems: addOnItems.filter((item) => item.amount > 0),
    total,
    fareLabel: fare?.fareType || fare?.label || null,
  };
}

function bookingItinerary(booking, searchRequest) {
  const service = bookingServiceName(booking);
  const snap = booking.items?.[0]?.snapshot || {};
  if (service === "bus") {
    const saved = booking.services?.bus || {};
    const query = saved.searchQuery || {};
    return {
      from: query.from || "",
      to: query.to || "",
      date: String(query.date || query.travelDate || "").slice(0, 10),
      seats: saved.selectedSeat || query.seats || "",
      operator: saved.operator || "",
      price: fareBreakdown(booking, null, []),
    };
  }
  if (service === 'flight') {
    const flight = snap.flight || {};
    const dep = flight.departure || {};
    const arr = flight.arrival || {};
    const chargedAmount =
      Number(snap.chargedUnitAmount) ||
      Number(snap.selectedFareQuote?.amount) ||
      Number(snap.flightFareData?.price?.amount) ||
      null;
    const farePrice = {
      amount: chargedAmount,
      currency:
        snap.selectedFareQuote?.currency ||
        snap.flightFareData?.price?.currency ||
        booking.currency ||
        'INR',
      fareType:
        snap.fareLabel ||
        snap.selectedFareQuote?.label ||
        snap.flightFareData?.fareType ||
        null,
      label:
        snap.fareLabel ||
        snap.selectedFareQuote?.label ||
        snap.flightFareData?.fareType ||
        null,
    };
    return {
      airline: flight.airline?.name || '',
      airlineCode: flight.airline?.code || '',
      flightNumber: flight.flightNumber || '',
      cabin: flight.cabinClass || snap.flightFareData?.cabinClass || '',
      fareLabel: farePrice.label,
      from: {
        city: dep.airportInfo?.cityName || '',
        airport: dep.airportInfo?.airportName || '',
        code: dep.airportInfo?.airportCode || dep.airport || '',
        ...clockParts(dep.at),
      },
      to: {
        city: arr.airportInfo?.cityName || '',
        airport: arr.airportInfo?.airportName || '',
        code: arr.airportInfo?.airportCode || arr.airport || '',
        ...clockParts(arr.at),
      },
      price: fareBreakdown(booking, farePrice, snap.addOns),
    };
  }
  if (service === "hotel") {
    const hotel = snap.hotel || {};
    const room = snap.selectedRoom || {};
    return {
      name: hotel.name || "",
      room: room.roomName || "",
      city: hotel.location?.city || searchRequest?.city || "",
      address: hotel.location?.addressLine1 || "",
      checkIn: String(room.checkIn || searchRequest?.checkIn || "").slice(0, 10),
      checkOut: String(room.checkOut || searchRequest?.checkOut || "").slice(0, 10),
      price: fareBreakdown(booking, room.price, snap.addOns),
    };
  }
  return { price: fareBreakdown(booking, null, []) };
}

function bookingServiceName(booking) {
  const folders = booking.services && typeof booking.services === 'object'
    ? Object.keys(booking.services)
    : [];
  if (folders.includes('bus')) return 'bus';
  if (folders.includes('hotel')) return 'hotel';
  if (folders.includes('flight')) return 'flight';
  return String(booking.productType || '').toLowerCase();
}

function bookingCard(booking, payment, searchRequest) {
  const item = booking.items?.[0];
  const snap = item?.snapshot || {};
  const flight = snap.flight || {};
  const service = bookingServiceName(booking);
  let title = booking.productType;
  const searchQuery = {};
  if (service === 'bus') {
    const saved = booking.services?.bus || {};
    const query = saved.searchQuery || {};
    searchQuery.from = query.from || '';
    searchQuery.to = query.to || '';
    searchQuery.date = String(query.date || query.travelDate || '').slice(0, 10);
    title = saved.title || [searchQuery.from, searchQuery.to].filter(Boolean).join(' → ') || 'Bus';
  } else if (booking.productType === 'FLIGHT' || service === 'flight') {
    const dep = flight.departure?.airportInfo?.cityName || flight.departure?.airport;
    const arr = flight.arrival?.airportInfo?.cityName || flight.arrival?.airport;
    title = [flight.airline?.name || flight.airline, dep && arr ? `${dep} → ${arr}` : null]
      .filter(Boolean)
      .join(' · ');
    searchQuery.from = dep || '';
    searchQuery.to = arr || '';
    searchQuery.depart = String(flight.departure?.at || '').slice(0, 10);
  } else if (booking.productType === 'HOTEL') {
    title = [snap.hotel?.name, snap.selectedRoom?.roomName].filter(Boolean).join(' · ');
    searchQuery.destination = snap.hotel?.name || snap.hotel?.location?.city || '';
    searchQuery.checkIn = String(
      snap.selectedRoom?.checkIn || snap.stay?.checkIn || searchRequest?.checkIn || '',
    ).slice(0, 10);
    searchQuery.checkOut = String(
      snap.selectedRoom?.checkOut || snap.stay?.checkOut || searchRequest?.checkOut || '',
    ).slice(0, 10);
    if (!searchQuery.destination && searchRequest?.city) searchQuery.destination = searchRequest.city;
  }
  const status = String(booking.status || '').toUpperCase();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const bookedDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(booking.bookedAtUtc || booking.createdAt || Date.now()));
  const travelDay = searchQuery.checkOut || searchQuery.depart || searchQuery.date || '';
  let tripPhase = 'upcoming';
  if (status === 'CANCELLED' || status === 'FAILED') tripPhase = 'cancelled';
  else if ((travelDay && travelDay < today) || (!travelDay && bookedDay < today)) {
    tripPhase = 'completed';
  }

  return {
    bookingId: booking.aplBookingRef,
    customerId: booking.customerProfileId || (booking.userId ? String(booking.userId) : null),
    productType: booking.productType,
    service,
    aplEntityId: item?.aplEntityId || null,
    bookingStatus: status.toLowerCase(),
    tripPhase,
    paymentStatus: payment ? payment.status : 'PENDING',
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    title: title || booking.aplBookingRef,
    searchQuery,
    travellers: (booking.travellers || []).map((traveller) => ({
      type: traveller.type,
      title: traveller.title,
      firstName: traveller.firstName,
      lastName: traveller.lastName,
    })),
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    createdAt: booking.createdAt,
    bookedAtUtc: booking.bookedAtUtc || booking.createdAt,
    bookedAtLocal: booking.bookedAtLocal,
    timeZone: booking.timeZone,
    itinerary: bookingItinerary(booking, searchRequest),
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

async function listBookingsForCustomer(user) {
  const customerId = String(user._id);
  if (user.email) {
    await Booking.updateMany(
      {
        guestEmail: String(user.email).toLowerCase(),
        $or: [{ userId: { $exists: false } }, { userId: null }],
      },
      { $set: { userId: user._id, customerProfileId: customerId } },
    );
  }
  const bookings = await Booking.find({
    $or: [{ userId: user._id }, { customerProfileId: customerId }],
  })
    .sort({ createdAt: -1 })
    .limit(100);
  const payments = await latestPaymentsFor(bookings);
  const searchIds = [...new Set(bookings.map((booking) => booking.searchId).filter(Boolean))];
  const searches = searchIds.length
    ? await Search.find({ aplSearchId: { $in: searchIds } }).select('aplSearchId request')
    : [];
  const searchById = new Map(searches.map((search) => [search.aplSearchId, search.request || {}]));
  const cards = bookings.map((booking) =>
    bookingCard(booking, payments.get(String(booking._id)), searchById.get(booking.searchId)),
  );
  const services = {};
  for (const card of cards) {
    const folder = card.service || 'other';
    if (!services[folder]) services[folder] = [];
    services[folder].push(card);
  }
  return {
    customerId,
    count: cards.length,
    bookings: cards,
    services,
  };
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

  return { bookingId: booking.aplBookingRef, productType: booking.productType, bookingStatus: booking.status, paymentStatus: 'REFUNDED', refundedAmount: booking.totalAmount, currency: booking.currency, balance: user ? user.balance : 0 };
}

async function claimRecordedBooking(user, body) {
  const clientReference = String(body?.clientReference || '').trim();
  if (!clientReference) throw AppError.validation('clientReference is required');
  const existing = await Booking.findOne({ clientReference, userId: user._id });
  if (existing) return getBookingByRef(existing.aplBookingRef, user._id);

  const productType = String(body.service || 'FLIGHT').toUpperCase();
  if (!['FLIGHT', 'HOTEL', 'BUS'].includes(productType)) {
    throw AppError.validation('service must be flight, hotel, or bus');
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw AppError.validation('amount is required');
  }
  const currency = String(body.currency || user.currency || 'INR').toUpperCase();
  const clock = bookingClock(new Date(), currency);
  const serviceName = serviceFolderName(productType);
  const storedType = productType === 'HOTEL' ? 'HOTEL' : 'FLIGHT';
  const aplBookingRef = formatAplBookingRef(crypto.randomBytes(4).toString('hex').toUpperCase());
  const travellers = Array.isArray(body.travellers) ? body.travellers : [];
  const searchQuery = body.searchQuery || {};
  const serviceRecord = {
    aplBookingRef,
    status: 'CONFIRMED',
    currency,
    totalAmount: amount,
    bookedAtUtc: clock.bookedAtUtc,
    bookedAtLocal: clock.bookedAtLocal,
    timeZone: clock.timeZone,
    guestEmail: user.email,
    title: body.title || '',
    searchQuery,
    clientReference,
  };

  const booking = await Booking.create({
    aplBookingRef,
    userId: user._id,
    customerProfileId: String(user._id),
    productType: storedType,
    status: 'CONFIRMED',
    currency,
    totalAmount: amount,
    guestEmail: user.email,
    guestPhone: body.phone || '',
    bookedAtUtc: clock.bookedAtUtc,
    timeZone: clock.timeZone,
    bookedAtLocal: clock.bookedAtLocal,
    clientReference,
    services: { [serviceName]: serviceRecord },
    searchId: body.searchId || undefined,
    travellers: travellers.map((person) => ({
      type: String(person.type || 'ADULT').toUpperCase(),
      title: person.title || 'Mr',
      firstName: person.firstName || 'Traveller',
      lastName: person.lastName || 'Guest',
    })),
    items: [
      {
        productType: storedType,
        aplEntityId: body.aplEntityId || clientReference,
        aplOfferId: body.aplOfferId || clientReference,
        supplierCode: 'TBO',
        supplierBookingRef: clientReference,
        supplierBookingStatus: 'CONFIRMED',
        amount,
        currency,
        snapshot: {
          flight: productType === 'FLIGHT'
            ? {
                airline: { name: body.airline || '' },
                departure: { airport: searchQuery.fromCode || searchQuery.from, at: searchQuery.depart ? `${searchQuery.depart}T00:00:00+05:30` : undefined },
                arrival: { airport: searchQuery.toCode || searchQuery.to },
              }
            : undefined,
          hotel: productType === 'HOTEL' ? { name: body.title || searchQuery.destination } : undefined,
          selectedRoom: productType === 'HOTEL'
            ? { roomName: body.roomName, checkIn: searchQuery.checkIn, checkOut: searchQuery.checkOut }
            : undefined,
        },
      },
    ],
  });

  await Payment.create({
    bookingId: booking._id,
    status: 'CAPTURED',
    amount,
    currency,
    provider: 'APL_MOCK_PAY',
    method: String(body.paymentMethod || 'CARD').toUpperCase(),
    last4: body.last4 || undefined,
  });

  return getBookingByRef(aplBookingRef, user._id);
}

module.exports = {
  createCheckoutSession,
  confirmBookingFromCheckout,
  getBookingByRef,
  listBookingsForCustomer,
  claimRecordedBooking,
  listBookingsByProduct,
  getBookingDetailsByProduct,
  cancelBooking,
};
