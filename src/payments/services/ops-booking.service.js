'use strict';

const { mongoose } = require('../../common/database/connection');
const { Booking, Payment } = require('../../common/database/models/Booking');
const CancellationRequest = require('../models/CancellationRequest');
const Refund = require('../models/Refund');
const Dsa = require('../../tenant/models/Dsa');
const { AppError } = require('../../common/errors/app-error');
const {
  toPublicPayment,
  normalizePaymentStatus,
} = require('./payment.service');
const {
  toPublicCancellation,
  toPublicRefund,
} = require('./cancellation.service');
const { logAdminAction } = require('../../apl-admin/services/admin-action-log');

function parsePage(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function commercialForAudience(snapshot, audience) {
  if (!snapshot) return null;
  if (audience === 'APL') {
    return {
      finalPrice: snapshot.finalPrice || null,
      supplierNet: snapshot.supplierNet || null,
      aplMarkup: snapshot.aplMarkup || null,
      dsaMarkup: snapshot.dsaMarkup || null,
      serviceFee: snapshot.serviceFee || null,
      discount: snapshot.discount || null,
      pricingVersion: snapshot.pricingVersion || null,
      appliedRules: snapshot.appliedRules || [],
    };
  }
  // DSA — hide APL internal margin / supplier net
  return {
    finalPrice: snapshot.finalPrice || null,
    dsaMarkup: snapshot.dsaMarkup || null,
    serviceFee: snapshot.serviceFee || null,
    discount: snapshot.discount || null,
    pricingVersion: snapshot.pricingVersion || null,
  };
}

function serializeBookingListItem(booking, payment, audience) {
  const item = booking.items?.[0];
  return {
    aplBookingRef: booking.aplBookingRef,
    productType: booking.productType,
    status: booking.status,
    paymentStatus: payment
      ? normalizePaymentStatus(payment.status)
      : 'PENDING',
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    dsaId: booking.dsaId ? String(booking.dsaId) : null,
    requestId: booking.requestId || null,
    supplierCode: item?.supplierCode || null,
    supplierBookingRef: item?.supplierBookingRef || null,
    bookedAtUtc: booking.bookedAtUtc || booking.createdAt,
    createdAt: booking.createdAt,
    pricingSummary:
      audience === 'DSA'
        ? {
            customerPrice: booking.totalAmount,
            currency: booking.currency,
            dsaMarkup: booking.commercialSnapshot?.dsaMarkup || null,
          }
        : {
            customerPrice: booking.totalAmount,
            currency: booking.currency,
            supplierNet: booking.commercialSnapshot?.supplierNet || null,
            aplMarkup: booking.commercialSnapshot?.aplMarkup || null,
            dsaMarkup: booking.commercialSnapshot?.dsaMarkup || null,
          },
  };
}

async function listBookings({ query = {}, dsaScope = null, audience = 'APL' }) {
  const { page, pageSize, skip } = parsePage(query);
  const filter = {};

  if (dsaScope) {
    filter.dsaId = dsaScope;
  } else if (query.dsaId) {
    if (!mongoose.isValidObjectId(query.dsaId)) {
      throw AppError.validation('Invalid dsaId filter');
    }
    filter.dsaId = query.dsaId;
  }

  if (query.service || query.productType) {
    filter.productType = String(query.service || query.productType).toUpperCase();
  }
  if (query.status || query.bookingStatus) {
    filter.status = String(query.status || query.bookingStatus).toUpperCase();
  }
  if (query.q || query.ref) {
    const q = String(query.q || query.ref).trim();
    filter.$or = [
      { aplBookingRef: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { guestEmail: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  let bookings = await Booking.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .lean();

  // Optional payment-status filter (post-join)
  const payments = await Payment.find({
    bookingId: { $in: bookings.map((b) => b._id) },
  })
    .sort({ createdAt: -1 })
    .lean();
  const payByBooking = new Map();
  for (const p of payments) {
    const key = String(p.bookingId);
    if (!payByBooking.has(key)) payByBooking.set(key, p);
  }

  if (query.paymentStatus) {
    const want = String(query.paymentStatus).toUpperCase();
    bookings = bookings.filter((b) => {
      const p = payByBooking.get(String(b._id));
      return normalizePaymentStatus(p?.status) === want;
    });
  }

  const total = await Booking.countDocuments(filter);
  const dsaIds = [
    ...new Set(bookings.map((b) => (b.dsaId ? String(b.dsaId) : null)).filter(Boolean)),
  ];
  const dsas = dsaIds.length
    ? await Dsa.find({ _id: { $in: dsaIds } })
        .select('dsaCode displayName companyName')
        .lean()
    : [];
  const dsaById = new Map(dsas.map((d) => [String(d._id), d]));

  return {
    items: bookings.map((b) => {
      const row = serializeBookingListItem(
        b,
        payByBooking.get(String(b._id)),
        audience,
      );
      const dsa = b.dsaId ? dsaById.get(String(b.dsaId)) : null;
      return {
        ...row,
        dsa: dsa
          ? {
              id: String(dsa._id),
              dsaCode: dsa.dsaCode,
              displayName: dsa.displayName || dsa.companyName,
            }
          : null,
      };
    }),
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getBookingDetail({
  aplBookingRef,
  dsaScope = null,
  audience = 'APL',
}) {
  const filter = { aplBookingRef };
  if (dsaScope) filter.dsaId = dsaScope;
  const booking = await Booking.findOne(filter).lean();
  if (!booking) throw AppError.notFound('Booking not found');

  const payment = await Payment.findOne({ bookingId: booking._id })
    .sort({ createdAt: -1 })
    .lean();
  const cancellations = await CancellationRequest.find({
    bookingId: booking._id,
  })
    .sort({ createdAt: -1 })
    .lean();
  const refunds = await Refund.find({ bookingId: booking._id })
    .sort({ createdAt: -1 })
    .lean();

  let dsa = null;
  if (booking.dsaId) {
    dsa = await Dsa.findById(booking.dsaId)
      .select('dsaCode displayName companyName email')
      .lean();
  }

  const item = booking.items?.[0];
  return {
    aplBookingRef: booking.aplBookingRef,
    productType: booking.productType,
    status: booking.status,
    currency: booking.currency,
    totalAmount: booking.totalAmount,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    userId: booking.userId ? String(booking.userId) : null,
    dsaId: booking.dsaId ? String(booking.dsaId) : null,
    dsa: dsa
      ? {
          id: String(dsa._id),
          dsaCode: dsa.dsaCode,
          displayName: dsa.displayName || dsa.companyName,
          email: dsa.email,
        }
      : null,
    requestId: booking.requestId || null,
    checkoutToken: audience === 'APL' ? booking.checkoutToken || null : undefined,
    searchId: booking.searchId || null,
    bookedAtUtc: booking.bookedAtUtc,
    bookedAtLocal: booking.bookedAtLocal,
    timeZone: booking.timeZone,
    travellers: booking.travellers || [],
    supplier: {
      code: item?.supplierCode || null,
      bookingRef: item?.supplierBookingRef || null,
      bookingStatus: item?.supplierBookingStatus || null,
    },
    commercial: commercialForAudience(booking.commercialSnapshot, audience),
    payment: toPublicPayment(payment),
    cancellations: cancellations.map(toPublicCancellation),
    refunds: refunds.map(toPublicRefund),
    timeline: buildTimeline({ booking, payment, cancellations, refunds }),
  };
}

function buildTimeline({ booking, payment, cancellations, refunds }) {
  const events = [];
  if (booking?.createdAt) {
    events.push({
      at: booking.createdAt,
      type: 'BOOKING',
      status: booking.status,
      ref: booking.aplBookingRef,
    });
  }
  if (payment?.createdAt) {
    events.push({
      at: payment.createdAt,
      type: 'PAYMENT',
      status: normalizePaymentStatus(payment.status),
      ref: payment.paymentRef,
    });
  }
  for (const c of cancellations || []) {
    events.push({
      at: c.createdAt,
      type: 'CANCELLATION',
      status: c.status,
      ref: c.cancellationRef,
    });
  }
  for (const r of refunds || []) {
    events.push({
      at: r.createdAt,
      type: 'REFUND',
      status: r.status,
      ref: r.refundRef,
    });
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

async function listPayments({ query = {}, dsaScope = null }) {
  const { page, pageSize, skip } = parsePage(query);
  const filter = {};
  if (dsaScope) filter.dsaId = dsaScope;
  else if (query.dsaId) filter.dsaId = query.dsaId;
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.q) {
    const q = String(query.q).trim();
    filter.$or = [
      { paymentRef: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { providerRef: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Payment.countDocuments(filter),
  ]);

  const bookingIds = items.map((p) => p.bookingId).filter(Boolean);
  const bookings = bookingIds.length
    ? await Booking.find({ _id: { $in: bookingIds } })
        .select('aplBookingRef productType status dsaId')
        .lean()
    : [];
  const bookingById = new Map(bookings.map((b) => [String(b._id), b]));

  const refunds = await Refund.find({
    paymentId: { $in: items.map((p) => p._id) },
  })
    .sort({ createdAt: -1 })
    .lean();
  const refundByPayment = new Map();
  for (const r of refunds) {
    const key = String(r.paymentId);
    if (!refundByPayment.has(key)) refundByPayment.set(key, r);
  }

  return {
    items: items.map((p) => {
      const b = p.bookingId ? bookingById.get(String(p.bookingId)) : null;
      const r = refundByPayment.get(String(p._id));
      return {
        ...toPublicPayment(p),
        booking: b
          ? {
              aplBookingRef: b.aplBookingRef,
              productType: b.productType,
              status: b.status,
              dsaId: b.dsaId ? String(b.dsaId) : null,
            }
          : null,
        refund: toPublicRefund(r),
      };
    }),
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function listRefunds({ query = {}, dsaScope = null }) {
  const { page, pageSize, skip } = parsePage(query);
  const filter = {};
  if (dsaScope) filter.dsaId = dsaScope;
  else if (query.dsaId) filter.dsaId = query.dsaId;
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.q) {
    const q = String(query.q).trim();
    filter.$or = [
      { refundRef: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { aplBookingRef: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }

  const [items, total] = await Promise.all([
    Refund.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Refund.countDocuments(filter),
  ]);

  return {
    items: items.map((r) => ({
      ...toPublicRefund(r),
      aplBookingRef: r.aplBookingRef,
      dsaId: r.dsaId ? String(r.dsaId) : null,
      kind: r.kind,
      breakdownNote: r.breakdown?.note || null,
    })),
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/**
 * Safe admin inspect only — no financial mutation helpers here by default.
 */
async function auditInspect({ actor, action, resourceType, resourceId, details }) {
  return logAdminAction({
    actor,
    action,
    resourceType,
    resourceId,
    details,
  });
}

module.exports = {
  listBookings,
  getBookingDetail,
  listPayments,
  listRefunds,
  auditInspect,
  commercialForAudience,
};
