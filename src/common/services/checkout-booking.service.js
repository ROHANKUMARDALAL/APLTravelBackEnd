'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../errors/app-error');
const { assertExactPrice } = require('../utils/price-confirm');
const {
  formatAplBookingRef,
} = require('../utils/apl-ids');
const CheckoutSession = require('../database/models/CheckoutSession');
const Search = require('../database/models/Search');
const { Booking, Payment } = require('../database/models/Booking');
const { bookingClock, serviceFolderName } = require('../utils/booking-time');
const AccountAction = require('../../user/models/AccountAction');
const {
  assertCheckoutTenantMatch,
  assertBookingTenantAccess,
} = require('../../tenant/services/transaction-tenant.service');
const {
  capturePayment,
  resolveChargeAmount,
  toPublicPayment,
  normalizePaymentStatus,
} = require('../../payments/services/payment.service');
const { canChangePoints } = require('../../bus/utils/point-window');
const {
  assertWalletCoversBooking,
  debitCustomerWalletForBooking,
  reverseCustomerWalletDebit,
} = require('../../wallet/customer-wallet-payment');
const {
  processCancellation,
  toPublicCancellation,
  toPublicRefund,
} = require('../../payments/services/cancellation.service');
const CancellationRequest = require('../../payments/models/CancellationRequest');
const Refund = require('../../payments/models/Refund');
const { writeLifecycleLog } = require('./lifecycle-log.service');
const { PaymentStatus } = require('../../payments/status');

/**
 * Shared checkout + booking (MMT/Paytm-style token flow).
 * 1) checkout → checkoutToken
 * 2) book with checkoutToken + payment provider (mock adapter)
 * Payment SUCCESS ≠ Booking CONFIRMED — tracked separately.
 */

async function createCheckoutSession({
  productType,
  searchId,
  aplOfferId,
  aplEntityId,
  offerSnapshot,
  pricing,
  commercialSnapshot,
  contact,
  travellers,
  dsaId,
  requestId,
  journeyId,
  userId,
}) {
  const checkoutToken = `chk_${uuidv4().replace(/-/g, '')}`;
  const session = await CheckoutSession.create({
    checkoutToken,
    productType,
    searchId,
    aplOfferId,
    aplEntityId,
    dsaId: dsaId || undefined,
    requestId: requestId || undefined,
    journeyId: journeyId || undefined,
    userId: userId || undefined,
    status: 'READY',
    contact,
    travellers,
    offerSnapshot,
    commercialSnapshot: commercialSnapshot || undefined,
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
    journeyId: session.journeyId || null,
    nextStep: 'POST /api/v1/{flights|hotels|buses|transfers}/book with checkoutToken + payment',
  };
}

async function loadConfirmedBookingResponse(booking, paymentDoc, user, offerSnapshot) {
  return {
    aplBookingRef: booking.aplBookingRef,
    bookingStatus: booking.status,
    paymentStatus: normalizePaymentStatus(paymentDoc?.status),
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
    dsaId: booking.dsaId ? String(booking.dsaId) : null,
    requestId: booking.requestId || null,
    searchId: booking.searchId || null,
    journeyId: booking.journeyId || booking.searchId || null,
    commercialSnapshot: booking.commercialSnapshot || null,
    items: (booking.items || []).map((i) => ({
      productType: i.productType,
      aplEntityId: i.aplEntityId,
      aplOfferId: i.aplOfferId,
      supplierCode: i.supplierCode,
      supplierBookingRef: i.supplierBookingRef,
      supplierBookingStatus: i.supplierBookingStatus,
      amount: i.amount,
      currency: i.currency,
    })),
    payment: toPublicPayment(paymentDoc),
    balance: user?.balance,
    offer: offerSnapshot,
    needsAttention: Boolean(paymentDoc?.needsAttention),
  };
}

async function waitForCheckoutSettlement(sessionId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const fresh = await CheckoutSession.findById(sessionId);
    if (!fresh || fresh.status !== 'PAYING') return fresh;
  }
  return CheckoutSession.findById(sessionId);
}

async function confirmBookingFromCheckout({
  checkoutToken,
  payment,
  confirmPrice,
  user,
  tenant,
  requestId,
  idempotencyKey,
  simulateBookingFailure = false,
}) {
  if (!user?._id) {
    throw AppError.unauthorized('Login token is required to book');
  }
  const session = await CheckoutSession.findOne({ checkoutToken });
  if (!session) {
    throw AppError.notFound('Invalid checkoutToken');
  }
  // Strip any client attempt to set booking tenancy via body — ownership from session.
  assertCheckoutTenantMatch(session, tenant);

  // Idempotent replay: already booked → return existing booking (no second charge).
  if (session.status === 'BOOKED' && session.aplBookingRef) {
    const existing = await Booking.findOne({
      aplBookingRef: session.aplBookingRef,
    });
    if (existing) {
      const pay = await Payment.findOne({ bookingId: existing._id }).sort({
        createdAt: -1,
      });
      const response = await loadConfirmedBookingResponse(
        existing,
        pay,
        user,
        session.offerSnapshot,
      );
      return { ...response, idempotentReplay: true };
    }
  }

  if (
    session.status === 'PAYMENT_CAPTURED_BOOKING_FAILED' &&
    session.paymentRef
  ) {
    const pay = await Payment.findOne({ paymentRef: session.paymentRef });
    throw AppError.validation(
      'Payment succeeded but booking confirmation previously failed. Contact support or retry booking recovery.',
      [
        {
          paymentRef: session.paymentRef,
          paymentStatus: pay ? normalizePaymentStatus(pay.status) : null,
          bookingConfirmStatus: pay?.bookingConfirmStatus,
          needsAttention: true,
        },
      ],
    );
  }

  if (session.expiresAt < new Date() || session.status === 'EXPIRED') {
    session.status = 'EXPIRED';
    await session.save();
    throw AppError.validation('Checkout session expired. Start checkout again.');
  }

  const baseCharge = resolveChargeAmount(session);
  assertExactPrice(
    { amount: baseCharge.amount, currency: baseCharge.currency },
    confirmPrice,
  );
  const charge = resolveChargeAmount(session, payment || {});
  if (payment?.amount != null && Number(payment.amount) !== charge.amount) {
    throw AppError.validation('Payment amount does not match the fare plus payment fee', [
      {
        requiredAmount: charge.amount,
        providedAmount: Number(payment.amount),
        feeAmount: charge.paymentFee,
        currency: charge.currency,
      },
    ]);
  }
  if (payment?.feeAmount != null && Number(payment.feeAmount) !== charge.paymentFee) {
    throw AppError.validation('Payment fee does not match the selected method', [
      {
        requiredFee: charge.paymentFee,
        providedFee: Number(payment.feeAmount),
        method: charge.paymentMethod,
      },
    ]);
  }

  if (charge.paymentMethod === 'WALLET') {
    await assertWalletCoversBooking({
      userId: user._id,
      dsaId: session.dsaId,
      currency: charge.currency,
      amount: charge.amount,
    });
  }

  // Atomic claim — prevents double-click creating two payments.
  const claimed = await CheckoutSession.findOneAndUpdate(
    {
      _id: session._id,
      status: { $in: ['READY', 'DRAFT'] },
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: 'PAYING' } },
    { new: true },
  );

  if (!claimed) {
    const fresh = await CheckoutSession.findById(session._id);
    if (fresh?.status === 'BOOKED' && fresh.aplBookingRef) {
      const existing = await Booking.findOne({
        aplBookingRef: fresh.aplBookingRef,
      });
      const pay = existing
        ? await Payment.findOne({ bookingId: existing._id }).sort({
            createdAt: -1,
          })
        : null;
      if (existing) {
        const response = await loadConfirmedBookingResponse(
          existing,
          pay,
          user,
          fresh.offerSnapshot,
        );
        return { ...response, idempotentReplay: true };
      }
    }
    if (fresh?.status === 'PAYING') {
      const settled = await waitForCheckoutSettlement(session._id);
      if (settled?.status === 'BOOKED' && settled.aplBookingRef) {
        const existing = await Booking.findOne({
          aplBookingRef: settled.aplBookingRef,
        });
        const pay = existing
          ? await Payment.findOne({ bookingId: existing._id }).sort({ createdAt: -1 })
          : null;
        if (existing) {
          const response = await loadConfirmedBookingResponse(
            existing,
            pay,
            user,
            settled.offerSnapshot,
          );
          return { ...response, idempotentReplay: true };
        }
      }
      throw AppError.validation(
        'Payment already in progress for this checkout. Retry shortly.',
      );
    }
    throw AppError.validation('Checkout session is not available for payment');
  }

  const payKey =
    idempotencyKey ||
    (payment && payment.idempotencyKey) ||
    `pay:${claimed.checkoutToken}`;

  let paymentDoc;
  try {
    const captured = await capturePayment({
      session: claimed,
      user,
      paymentInput: payment || {},
      idempotencyKey: payKey,
      requestId: requestId || claimed.requestId,
    });
    paymentDoc = captured.payment;

    // Duplicate successful payment for same key while booking already exists.
    if (captured.duplicate && paymentDoc.bookingId) {
      const existing = await Booking.findById(paymentDoc.bookingId);
      if (existing) {
        claimed.status = 'BOOKED';
        claimed.aplBookingRef = existing.aplBookingRef;
        claimed.paymentRef = paymentDoc.paymentRef;
        await claimed.save();
        const response = await loadConfirmedBookingResponse(
          existing,
          paymentDoc,
          user,
          claimed.offerSnapshot,
        );
        return { ...response, idempotentReplay: true };
      }
    }
  } catch (err) {
    // Release claim on payment failure so customer can retry with new key.
    if (claimed.status === 'PAYING') {
      claimed.status = 'READY';
      await claimed.save().catch(() => {});
    }
    throw err;
  }

  claimed.paymentRef = paymentDoc.paymentRef;
  await claimed.save();

  paymentDoc.bookingConfirmStatus = 'ATTEMPTED';
  await paymentDoc.save();

  await writeLifecycleLog({
    stage: 'BOOKING_CONFIRM_ATTEMPT',
    service: String(claimed.productType || 'FLIGHT').toLowerCase(),
    operation: 'BOOKING_CONFIRM',
    requestId: requestId || claimed.requestId,
    dsaId: claimed.dsaId,
    userId: user._id,
    status: 'SUCCESS',
    result: {
      checkoutToken: claimed.checkoutToken,
      paymentRef: paymentDoc.paymentRef,
    },
  });

  // Dev-only recoverable failure path: payment SUCCESS + booking FAILED.
  if (
    simulateBookingFailure === true ||
    String(payment?.simulateBookingFailure || '').toLowerCase() === 'true'
  ) {
    paymentDoc.bookingConfirmStatus = 'FAILED';
    paymentDoc.needsAttention = true;
    await paymentDoc.save();
    claimed.status = 'PAYMENT_CAPTURED_BOOKING_FAILED';
    await claimed.save();
    await writeLifecycleLog({
      stage: 'BOOKING_FAILED',
      service: String(claimed.productType || 'FLIGHT').toLowerCase(),
      operation: 'BOOKING_CONFIRM',
      requestId: requestId || claimed.requestId,
      dsaId: claimed.dsaId,
      userId: user._id,
      status: 'FAILED',
      errorMessage: 'Simulated booking confirmation failure after payment success',
      result: {
        paymentRef: paymentDoc.paymentRef,
        paymentStatus: PaymentStatus.SUCCESS,
        recoverable: true,
      },
    });
    throw AppError.validation(
      'Payment succeeded but booking confirmation failed. Payment captured; booking not confirmed.',
      [
        {
          paymentRef: paymentDoc.paymentRef,
          paymentStatus: PaymentStatus.SUCCESS,
          bookingConfirmStatus: 'FAILED',
          needsAttention: true,
        },
      ],
    );
  }

  const aplBookingRef = formatAplBookingRef(
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
  let supplierCode = claimed.offerSnapshot?.supplier || 'TBO';
  let supplierBookingRef = claimed.productType === 'FLIGHT'
    ? null
    : `PNR${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  if (claimed.productType === 'INSURANCE') {
    const { mockInsuranceAdapter } = require('../../insurance/suppliers/mock-insure.adapter');
    const issued = await mockInsuranceAdapter.issueDemo(claimed.offerSnapshot || {}, {
      requestId: requestId || claimed.requestId,
      dsaId: claimed.dsaId,
      userId: user._id,
      searchId: claimed.searchId,
      journeyId: claimed.journeyId,
    });
    supplierCode = 'MOCK_INSURE';
    supplierBookingRef = issued.reference;
  }
  if (claimed.productType === 'FLIGHT') {
    const { assertFareConfirmation } = require('../../flight/services/flight-journey.policy');
    const Search = require('../database/models/Search');
    const owned = claimed.journeyId
      ? await Search.findOne({
        type: 'FLIGHT',
        $or: [{ journeyId: claimed.journeyId }, { 'journeys.journeyId': claimed.journeyId }],
      }).lean()
      : null;
    const journey = (owned?.journeys || []).find((row) => row.journeyId === claimed.journeyId) || null;
    try {
      assertFareConfirmation(journey, {
        aplFareId: claimed.offerSnapshot?.aplFareId,
        supplier: supplierCode,
      });
    } catch (error) {
      await writeLifecycleLog({
        requestId: requestId || claimed.requestId,
        journeyId: claimed.journeyId || undefined,
        businessOperation: 'BOOK',
        dsaId: claimed.dsaId,
        userId: user._id,
        service: 'FLIGHT',
        operation: 'BOOK',
        supplierCode,
        searchId: claimed.searchId,
        stage: 'OUTBOUND_RESPONSE',
        direction: 'INBOUND',
        status: 'FAILED',
        httpStatus: 400,
        errorMessage: error.message,
        result: { status: 'FAILED' },
      });
      throw error;
    }
    const { getFlightAdapter } = require('../../flight/suppliers/registry');
    const adapter = getFlightAdapter(supplierCode);
    const bookLog = {
      requestId: requestId || claimed.requestId,
      journeyId: claimed.journeyId || undefined,
      businessOperation: 'BOOK',
      dsaId: claimed.dsaId,
      userId: user._id,
      service: 'FLIGHT',
      operation: 'BOOK',
      supplierCode,
      searchId: claimed.searchId,
    };
    await writeLifecycleLog({
      ...bookLog,
      stage: 'INBOUND_REQUEST',
      direction: 'INBOUND',
      status: 'SUCCESS',
      request: {
        checkoutToken: claimed.checkoutToken,
        blockRef: claimed.block?.blockRef || null,
        supplier: supplierCode,
        paymentRef: paymentDoc.paymentRef,
      },
    });
    await writeLifecycleLog({
      ...bookLog,
      stage: 'SUPPLIER_REQUEST',
      direction: 'SUPPLIER',
      status: 'SUCCESS',
      storeRaw: true,
      rawPayload: {
        supplier: supplierCode,
        offerId: claimed.aplOfferId,
        blockRef: claimed.block?.supplierBlockRef || null,
      },
    });
    if (!adapter || typeof adapter.bookFlight !== 'function') {
      throw AppError.validation('Booking is not available for the selected supplier');
    }
    const booked = await adapter.bookFlight(claimed.offerSnapshot || {}, {});
    if (!booked || booked.status !== 'SUCCESS' || !booked.pnr) {
        paymentDoc.bookingConfirmStatus = 'FAILED';
        paymentDoc.needsAttention = true;
        await paymentDoc.save();
        claimed.status = 'PAYMENT_CAPTURED_BOOKING_FAILED';
        await claimed.save();
        await writeLifecycleLog({
          ...bookLog,
          stage: 'SUPPLIER_RESPONSE',
          direction: 'SUPPLIER',
          status: 'FAILED',
          storeRaw: true,
          rawPayload: booked || { status: 'FAILED' },
          errorCode: booked?.errorCode || 'MOCK_SUPPLIER_BOOK_FAILED',
          errorMessage: booked?.errorMessage || 'Mock supplier did not confirm the booking',
        });
        await writeLifecycleLog({
          ...bookLog,
          stage: 'OUTBOUND_RESPONSE',
          direction: 'INBOUND',
          status: 'FAILED',
          errorCode: booked?.errorCode || 'MOCK_SUPPLIER_BOOK_FAILED',
          errorMessage: booked?.errorMessage || 'Mock supplier did not confirm the booking',
          result: {
            paymentRef: paymentDoc.paymentRef,
            paymentStatus: PaymentStatus.SUCCESS,
            recoverable: true,
            pnr: null,
          },
        });
        throw AppError.validation(
          'Payment succeeded but the supplier did not confirm the booking.',
          [
            {
              paymentRef: paymentDoc.paymentRef,
              paymentStatus: PaymentStatus.SUCCESS,
              bookingConfirmStatus: 'FAILED',
              supplierError: booked?.errorCode || 'MOCK_SUPPLIER_BOOK_FAILED',
              needsAttention: true,
            },
          ],
        );
      }
      supplierBookingRef = booked.pnr;
      if (claimed.offerSnapshot?.returnJourney) {
        const returnBooked = await adapter.bookFlight(claimed.offerSnapshot.returnJourney, {});
        if (!returnBooked || returnBooked.status !== 'SUCCESS' || !returnBooked.pnr) {
          paymentDoc.bookingConfirmStatus = 'FAILED';
          paymentDoc.needsAttention = true;
          await paymentDoc.save();
          claimed.status = 'PAYMENT_CAPTURED_BOOKING_FAILED';
          await claimed.save();
          throw AppError.validation(
            'Payment succeeded but the supplier did not confirm the return journey.',
            [
              {
                paymentRef: paymentDoc.paymentRef,
                paymentStatus: PaymentStatus.SUCCESS,
                bookingConfirmStatus: 'FAILED',
                supplierError: returnBooked?.errorCode || 'MOCK_SUPPLIER_BOOK_FAILED',
                needsAttention: true,
              },
            ],
          );
        }
        claimed.offerSnapshot.returnJourney.supplierBookingRef = returnBooked.pnr;
      }
      await writeLifecycleLog({
        ...bookLog,
        stage: 'SUPPLIER_RESPONSE',
        direction: 'SUPPLIER',
        status: 'SUCCESS',
        storeRaw: true,
        rawPayload: booked,
      });
      await writeLifecycleLog({
        ...bookLog,
        stage: 'OUTBOUND_RESPONSE',
        direction: 'INBOUND',
        status: 'SUCCESS',
        result: {
          pnr: supplierBookingRef,
          supplier: supplierCode,
          bookingStatus: 'CONFIRMED',
          testBooking: true,
        },
      });
  }

  const clock = bookingClock(new Date(), charge.currency);
  const serviceName = serviceFolderName(claimed.productType);
  const items = [
    {
      productType: claimed.productType,
      aplEntityId: claimed.aplEntityId,
      aplOfferId: claimed.aplOfferId,
      supplierCode,
      supplierBookingRef,
      supplierBookingStatus: 'CONFIRMED',
      amount: charge.amount,
      currency: charge.currency,
      snapshot: claimed.offerSnapshot,
    },
  ];
  const returnJourney = claimed.offerSnapshot?.returnJourney;
  if (returnJourney?.supplierBookingRef) {
    items.push({
      productType: claimed.productType,
      aplEntityId: returnJourney.aplFlightId,
      aplOfferId: returnJourney.aplFareId,
      supplierCode: returnJourney.supplier || supplierCode,
      supplierBookingRef: returnJourney.supplierBookingRef,
      supplierBookingStatus: 'CONFIRMED',
      amount: returnJourney.chargedUnitAmount,
      currency: charge.currency,
      snapshot: returnJourney,
    });
  }
  const serviceRecord = {
    aplBookingRef,
    status: 'CONFIRMED',
    currency: baseCharge.currency,
    totalAmount: baseCharge.amount,
    bookedAtUtc: clock.bookedAtUtc,
    bookedAtLocal: clock.bookedAtLocal,
    timeZone: clock.timeZone,
    guestEmail: claimed.contact.email,
    guestPhone: claimed.contact.phone,
    travellers: claimed.travellers,
    items,
  };

  if (claimed.productType === 'BUS') {
    const snap = claimed.offerSnapshot || {};
    serviceRecord.operator = snap.operator || '';
    serviceRecord.title =
      [snap.departure?.city, snap.arrival?.city].filter(Boolean).join(' → ') ||
      snap.operator ||
      'Bus';
    serviceRecord.travelDate = snap.travelDate || null;
    serviceRecord.selectedSeats = snap.selectedSeats || [];
    serviceRecord.selectedSeat = (snap.selectedSeats || []).join(', ');
    serviceRecord.boardingPoint = snap.boardingPoint || null;
    serviceRecord.droppingPoint = snap.droppingPoint || null;
    serviceRecord.originalBoardingPoint = snap.boardingPoint || null;
    serviceRecord.originalDroppingPoint = snap.droppingPoint || null;
    serviceRecord.boardingPoints = snap.boardingPoints || [];
    serviceRecord.droppingPoints = snap.droppingPoints || [];
    serviceRecord.departureAt = snap.departureAt || null;
    serviceRecord.departureTimeZone = snap.departureTimeZone || null;
    serviceRecord.pointChanges = [];
    serviceRecord.pointRevision = 0;
    serviceRecord.busType = snap.busType || null;
    serviceRecord.searchQuery = {
      from: snap.departure?.city || '',
      to: snap.arrival?.city || '',
      date: snap.travelDate || '',
      travelDate: snap.travelDate || '',
      seats: serviceRecord.selectedSeat,
    };
  }

  if (claimed.productType === 'INSURANCE') {
    const snap = claimed.offerSnapshot || {};
    serviceRecord.title = `${snap.provider || 'Mock insurer'} · ${snap.planName || 'Demo plan'}`;
    serviceRecord.demo = true;
    serviceRecord.coverageNote = 'DEMO / MOCK. This is not an insurance policy or certificate.';
    serviceRecord.destination = snap.destination || null;
    serviceRecord.departureDate = snap.departureDate || null;
    serviceRecord.returnDate = snap.returnDate || null;
  }

  if (claimed.productType === 'TRANSFER') {
    const snap = claimed.offerSnapshot || {};
    serviceRecord.title =
      [snap.pickup?.name, snap.dropoff?.name].filter(Boolean).join(' → ') ||
      snap.vehicleName ||
      'Transfer';
    serviceRecord.vehicleName = snap.vehicleName || '';
    serviceRecord.vehicleCategory = snap.vehicleCategory || '';
    serviceRecord.pickup = snap.pickup || null;
    serviceRecord.dropoff = snap.dropoff || null;
    serviceRecord.pickupDateTime = snap.pickupDateTime || null;
    serviceRecord.flightNumber = snap.flightNumber || null;
    serviceRecord.pickupInstructions = snap.pickupInstructions || null;
    serviceRecord.pickupContact = snap.pickupContact || null;
    serviceRecord.pickupPoint = snap.pickupPoint || null;
    serviceRecord.supplier = snap.supplier || '';
    serviceRecord.supplierServiceId = snap.supplierServiceId || '';
    serviceRecord.aplTransferId = snap.aplTransferId || null;
    serviceRecord.aplOfferId = snap.aplOfferId || null;
    serviceRecord.searchQuery = {
      from: snap.pickup?.name || '',
      to: snap.dropoff?.name || '',
      date: String(snap.pickupDateTime || '').slice(0, 10),
      pickupDateTime: snap.pickupDateTime || '',
    };
  }

  let booking;
  let walletDebit = null;
  if (charge.paymentMethod === 'WALLET') {
    try {
      walletDebit = await debitCustomerWalletForBooking({
        userId: user._id,
        dsaId: claimed.dsaId,
        currency: charge.currency,
        amount: charge.amount,
        paymentRef: paymentDoc.paymentRef,
        bookingReference: aplBookingRef,
        serviceCode: claimed.productType,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_WALLET_BALANCE' && claimed.status === 'PAYING') {
        claimed.status = 'READY';
        await claimed.save().catch(() => {});
      }
      throw err;
    }
  }
  try {
    const paidAmount = Number(charge.amount) || 0;
    const method = ['WALLET', 'UPI', 'CARD', 'NET_BANKING'].includes(String(charge.paymentMethod || '').toUpperCase())
      ? String(charge.paymentMethod).toUpperCase()
      : 'OTHER';
    booking = await Booking.create({
      aplBookingRef,
      userId: user._id,
      customerProfileId: String(user._id),
      customerName: user.name || '',
      dsaId: claimed.dsaId || undefined,
      serviceCode: claimed.productType,
      supplierCode: items[0]?.supplierCode || '',
      paymentSummary: {
        method,
        provider: 'APL_MOCK_PAY',
        paymentRef: paymentDoc.paymentRef,
        status: 'SUCCESS',
        paidAmount,
        walletAmount: method === 'WALLET' ? paidAmount : 0,
        gatewayAmount: method === 'WALLET' ? 0 : paidAmount,
        feeAmount: Number(charge.paymentFee) || 0,
        currency: charge.currency,
        paidAt: clock.bookedAtUtc,
      },
      serviceDetails: serviceRecord,
      requestId: requestId || claimed.requestId || undefined,
      journeyId: claimed.journeyId || undefined,
      productType: claimed.productType,
      status: 'CONFIRMED',
      currency: baseCharge.currency,
      totalAmount: baseCharge.amount,
      commercialSnapshot: {
        ...(claimed.commercialSnapshot || {}),
        paymentCharge: {
          method: charge.paymentMethod,
          rateBps: charge.rateBps,
          baseAmount: charge.baseAmount,
          feeAmount: charge.paymentFee,
          totalAmount: charge.amount,
          currency: charge.currency,
          provider: 'APL_MOCK_PAY',
          simulated: true,
        },
      },
      bookedAtUtc: clock.bookedAtUtc,
      timeZone: clock.timeZone,
      bookedAtLocal: clock.bookedAtLocal,
      services: { [serviceName]: serviceRecord },
      guestEmail: claimed.contact.email,
      guestPhone: claimed.contact.phone,
      checkoutToken,
      searchId: claimed.searchId,
      travellers: claimed.travellers,
      items,
    });
    const { settleBookingDebit } = require('../../wallet/dsa-agency-wallet.service');
    await settleBookingDebit({
      dsaId: claimed.dsaId,
      aplBookingRef,
      amountMajor: baseCharge.amount,
      actor: { id: String(user._id), email: claimed.contact?.email || '' },
    });
  } catch (err) {
    if (walletDebit) {
      await reverseCustomerWalletDebit({
        userId: user._id,
        dsaId: claimed.dsaId,
        currency: charge.currency,
        amount: charge.amount,
        paymentRef: paymentDoc.paymentRef,
        serviceCode: claimed.productType,
      });
    }
    paymentDoc.bookingConfirmStatus = 'FAILED';
    paymentDoc.needsAttention = true;
    await paymentDoc.save();
    claimed.status = 'PAYMENT_CAPTURED_BOOKING_FAILED';
    await claimed.save();
    await writeLifecycleLog({
      stage: 'BOOKING_FAILED',
      service: String(claimed.productType || 'FLIGHT').toLowerCase(),
      operation: 'BOOKING_CONFIRM',
      requestId: requestId || claimed.requestId,
      dsaId: claimed.dsaId,
      userId: user._id,
      status: 'FAILED',
      errorMessage: err.message,
      result: {
        paymentRef: paymentDoc.paymentRef,
        paymentStatus: PaymentStatus.SUCCESS,
        recoverable: true,
      },
    });
    throw AppError.validation(
      'Payment succeeded but booking confirmation failed. Payment captured; booking not confirmed.',
      [
        {
          paymentRef: paymentDoc.paymentRef,
          paymentStatus: PaymentStatus.SUCCESS,
          bookingConfirmStatus: 'FAILED',
          needsAttention: true,
        },
      ],
    );
  }

  paymentDoc.bookingId = booking._id;
  paymentDoc.bookingConfirmStatus = 'CONFIRMED';
  paymentDoc.needsAttention = false;
  await paymentDoc.save();

  claimed.status = 'BOOKED';
  claimed.aplBookingRef = aplBookingRef;
  await claimed.save();

  let balanceAfter = walletDebit ? walletDebit.balance : user.balance;
  if (walletDebit) {
    user.balance = walletDebit.balance;
    await user.save();
  }

  await AccountAction.create({
    userId: user._id,
    type: 'PAYMENT',
    direction: 'DEBIT',
    aplBookingRef,
    productType: claimed.productType,
    amount: charge.amount,
    currency: charge.currency,
    balanceAfter,
    paymentMethod: payment.method,
    paymentStatus: PaymentStatus.SUCCESS,
    note:
      payment.method === 'WALLET'
        ? 'Wallet payment captured'
        : 'External payment captured',
  });

  await writeLifecycleLog({
    stage: 'BOOKING_CONFIRMED',
    service: String(claimed.productType || 'FLIGHT').toLowerCase(),
    operation: 'BOOKING_CONFIRM',
    requestId: booking.requestId,
    dsaId: booking.dsaId,
    userId: user._id,
    status: 'SUCCESS',
    result: {
      aplBookingRef,
      paymentRef: paymentDoc.paymentRef,
      supplierBookingRef,
    },
  });

  return loadConfirmedBookingResponse(
    booking,
    paymentDoc,
    user,
    claimed.offerSnapshot,
  );
}

async function getBookingByRef(aplBookingRef, userId, options = {}) {
  const filter = { aplBookingRef };
  if (userId) filter.userId = userId;
  const booking = await Booking.findOne(filter);
  if (!booking) throw AppError.notFound(`Booking not found: ${aplBookingRef}`);
  if (options.tenant) {
    assertBookingTenantAccess(booking, options.tenant);
  }
  const payment = await Payment.findOne({ bookingId: booking._id }).sort({
    createdAt: -1,
  });
  const cancellation = await CancellationRequest.findOne({
    bookingId: booking._id,
  }).sort({ createdAt: -1 });
  const refund = cancellation?.refundId
    ? await Refund.findById(cancellation.refundId)
    : await Refund.findOne({ bookingId: booking._id }).sort({ createdAt: -1 });
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
    dsaId: booking.dsaId ? String(booking.dsaId) : null,
    requestId: booking.requestId || null,
    commercialSnapshot: options.includeCommercialSnapshot
      ? booking.commercialSnapshot || null
      : undefined,
    payment: toPublicPayment(payment),
    cancellation: toPublicCancellation(cancellation),
    refund: toPublicRefund(refund),
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
    const itemSnap = booking.items?.[0]?.snapshot || {};
    return {
      from: query.from || itemSnap.departure?.city || "",
      to: query.to || itemSnap.arrival?.city || "",
      date: String(
        query.date || query.travelDate || itemSnap.travelDate || "",
      ).slice(0, 10),
      seats:
        saved.selectedSeat ||
        (Array.isArray(itemSnap.selectedSeats)
          ? itemSnap.selectedSeats.join(', ')
          : '') ||
        query.seats ||
        "",
      operator: saved.operator || itemSnap.operator || "",
      busType: saved.busType || itemSnap.busType || "",
      boardingPoint: saved.boardingPoint || itemSnap.boardingPoint || null,
      droppingPoint: saved.droppingPoint || itemSnap.droppingPoint || null,
      boardingPoints: saved.boardingPoints || itemSnap.boardingPoints || [],
      droppingPoints: saved.droppingPoints || itemSnap.droppingPoints || [],
      departureAt: saved.departureAt || itemSnap.departureAt || null,
      departureTimeZone: saved.departureTimeZone || itemSnap.departureTimeZone || null,
      pointChangeAllowed: canChangePoints(saved.departureAt || itemSnap.departureAt),
      pointChanges: saved.pointChanges || [],
      price: fareBreakdown(booking, null, []),
    };
  }
  if (service === 'transfer') {
    const saved = booking.services?.transfer || {};
    const query = saved.searchQuery || {};
    const itemSnap = booking.items?.[0]?.snapshot || {};
    return {
      from: query.from || itemSnap.pickup?.name || '',
      to: query.to || itemSnap.dropoff?.name || '',
      date: String(
        query.date || query.pickupDateTime || itemSnap.pickupDateTime || '',
      ).slice(0, 10),
      pickupDateTime: saved.pickupDateTime || itemSnap.pickupDateTime || '',
      vehicleName: saved.vehicleName || itemSnap.vehicleName || '',
      vehicleCategory: saved.vehicleCategory || itemSnap.vehicleCategory || '',
      pickup: saved.pickup || itemSnap.pickup || null,
      dropoff: saved.dropoff || itemSnap.dropoff || null,
      pickupPoint: saved.pickupPoint || itemSnap.pickupPoint || null,
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
  if (folders.includes('transfer')) return 'transfer';
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
  } else if (service === 'transfer') {
    const saved = booking.services?.transfer || {};
    const query = saved.searchQuery || {};
    searchQuery.from = query.from || saved.pickup?.name || '';
    searchQuery.to = query.to || saved.dropoff?.name || '';
    searchQuery.date = String(query.date || saved.pickupDateTime || '').slice(0, 10);
    title =
      saved.title ||
      [searchQuery.from, searchQuery.to].filter(Boolean).join(' → ') ||
      saved.vehicleName ||
      'Transfer';
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
  } else if (booking.productType === 'INSURANCE') {
    const saved = booking.services?.insurance || {};
    title = saved.title || snap.planName || 'Insurance demo';
    searchQuery.destination = saved.destination || snap.destination || searchRequest?.destination || '';
    searchQuery.depart = String(saved.departureDate || snap.departureDate || searchRequest?.departureDate || '').slice(0, 10);
    searchQuery.date = searchQuery.depart;
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
    paymentStatus: payment
      ? normalizePaymentStatus(payment.status)
      : 'PENDING',
    cancellationStatus: null,
    refundStatus: null,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    title: title || booking.aplBookingRef,
    searchQuery,
    travellers: (booking.travellers || []).map((traveller) => ({
      type: traveller.type,
      title: traveller.title,
      firstName: traveller.firstName,
      lastName: traveller.lastName,
      age: traveller.age,
      beneficiary: traveller.beneficiary
        ? {
          firstName: traveller.beneficiary.firstName,
          lastName: traveller.beneficiary.lastName,
          relationship: traveller.beneficiary.relationship,
        }
        : null,
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

async function listBookingsForCustomer(user, options = {}) {
  const customerId = String(user._id);
  if (user.email && options.tenant?.dsaId) {
    await Booking.updateMany(
      {
        guestEmail: String(user.email).toLowerCase(),
        dsaId: options.tenant.dsaId,
        $or: [{ userId: { $exists: false } }, { userId: null }],
      },
      { $set: { userId: user._id, customerProfileId: customerId } },
    );
  }
  const filter = { userId: user._id };
  if (options.tenant?.dsaId) filter.dsaId = options.tenant.dsaId;
  const bookings = await Booking.find(filter)
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

async function listBookingsByProduct(productType, userId, options = {}) {
  const filter = { productType, userId };
  if (options.tenant?.dsaId) filter.dsaId = options.tenant.dsaId;
  const bookings = await Booking.find(filter).sort({ createdAt: -1 }).limit(100);
  const payments = await latestPaymentsFor(bookings);
  return {
    productType,
    count: bookings.length,
    bookings: bookings.map((booking) =>
      bookingCard(booking, payments.get(String(booking._id))),
    ),
  };
}

async function getBookingDetailsByProduct({ bookingId, productType, userId, tenant }) {
  if (!bookingId || typeof bookingId !== 'string' || !bookingId.startsWith('APL-BK-')) {
    throw AppError.validation('bookingId is required (APL-BK-...)');
  }
  const details = await getBookingByRef(bookingId, userId, { tenant });
  if (details.productType !== productType) {
    throw AppError.notFound(`${productType} booking not found: ${bookingId}`);
  }
  return {
    bookingId: details.aplBookingRef,
    ...details,
  };
}

async function cancelBooking({
  bookingId,
  userId,
  productType,
  tenant,
  reason,
  requestId,
  idempotencyKey,
}) {
  if (!bookingId || typeof bookingId !== 'string' || !bookingId.startsWith('APL-BK-')) {
    throw AppError.validation('bookingId is required (APL-BK-...)');
  }
  const booking = await Booking.findOne({ aplBookingRef: bookingId, userId });
  if (!booking || (productType && booking.productType !== productType)) {
    throw AppError.notFound(`Booking not found: ${bookingId}`);
  }
  if (tenant) {
    assertBookingTenantAccess(booking, tenant);
  }

  const result = await processCancellation({
    booking,
    userId,
    reason: reason || 'Customer cancellation request',
    requestedBy: 'CUSTOMER',
    requestId,
    idempotencyKey: idempotencyKey || `cancel:${bookingId}:${userId}`,
  });

  return result.public;
}

async function claimRecordedBooking(user, body) {
  const clientReference = String(body?.clientReference || '').trim();
  if (!clientReference) throw AppError.validation('clientReference is required');
  const existing = await Booking.findOne({ clientReference, userId: user._id });
  if (existing) return getBookingByRef(existing.aplBookingRef, user._id);

  const productType = String(body.service || 'FLIGHT').toUpperCase();
  if (!['FLIGHT', 'HOTEL', 'BUS', 'TRANSFER'].includes(productType)) {
    throw AppError.validation('service must be flight, hotel, bus, or transfer');
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw AppError.validation('amount is required');
  }
  const currency = String(body.currency || user.currency || 'INR').toUpperCase();
  const clock = bookingClock(new Date(), currency);
  const serviceName = serviceFolderName(productType);
  const storedType =
    productType === 'HOTEL'
      ? 'HOTEL'
      : productType === 'BUS'
        ? 'BUS'
        : productType === 'TRANSFER'
          ? 'TRANSFER'
          : 'FLIGHT';
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
          bus: productType === 'BUS'
            ? {
                operator: body.operator || body.title || '',
                origin: searchQuery.from || searchQuery.origin,
                destination: searchQuery.to || searchQuery.destination,
                journeyDate: searchQuery.depart || searchQuery.journeyDate,
              }
            : undefined,
          transfer: productType === 'TRANSFER'
            ? {
                vehicleName: body.title || body.vehicleName || '',
                pickup: searchQuery.from || searchQuery.pickup,
                dropoff: searchQuery.to || searchQuery.dropoff,
                pickupDateTime: searchQuery.pickupDateTime || searchQuery.date,
              }
            : undefined,
        },
      },
    ],
  });

  await Payment.create({
    bookingId: booking._id,
    paymentRef: `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
    status: PaymentStatus.SUCCESS,
    amount,
    currency,
    provider: 'APL_MOCK_PAY',
    method: String(body.paymentMethod || 'CARD').toUpperCase(),
    last4: body.last4 || undefined,
    userId: user._id,
    bookingConfirmStatus: 'CONFIRMED',
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
