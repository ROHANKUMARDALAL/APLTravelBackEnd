'use strict';

/**
 * Booking foundation models.
 * Booking status, payment status, and supplier booking status remain separate.
 */

const { mongoose } = require('../connection');

const BookingItemSchema = new mongoose.Schema(
  {
    productType: { type: String, required: true },
    aplEntityId: { type: String },
    aplOfferId: { type: String },
    supplierCode: { type: String },
    supplierBookingRef: { type: String },
    supplierBookingStatus: {
      type: String,
      enum: ['NOT_STARTED', 'HELD', 'CONFIRMED', 'CANCELLED', 'FAILED'],
      default: 'NOT_STARTED',
    },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

const TravellerSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    title: { type: String },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    dateOfBirth: { type: String },
    gender: { type: String },
    email: { type: String },
    phone: { type: String },
    nationality: { type: String },
    passportNumber: { type: String },
    passportExpiry: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const BookingSchema = new mongoose.Schema(
  {
    aplBookingRef: { type: String, required: true, unique: true },
    productType: {
      type: String,
      enum: ['FLIGHT', 'HOTEL'],
      required: true,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED'],
      default: 'DRAFT',
    },
    currency: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    guestEmail: { type: String },
    guestPhone: { type: String },
    customerProfileId: { type: String },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    checkoutToken: { type: String, index: true },
    searchId: { type: String },
    /** Local confirmation number claimed onto this customer, so a reload does not duplicate it. */
    clientReference: { type: String, sparse: true, unique: true },
    /** UTC instant used only to order bookings, newest first. */
    bookedAtUtc: { type: Date, index: true },
    /** IANA zone chosen from the booking currency. */
    timeZone: { type: String, default: 'Asia/Kolkata' },
    /** Wall clock stored for reading. INR is IST. Other currencies use that country. */
    bookedAtLocal: { type: String },
    /**
     * Service folders. A hotel booking lives under services.hotel,
     * a flight under services.flight.
     */
    services: { type: mongoose.Schema.Types.Mixed, default: {} },
    items: { type: [BookingItemSchema], default: [] },
    travellers: { type: [TravellerSchema], default: [] },
  },
  { timestamps: true },
);

BookingSchema.index({ productType: 1, createdAt: -1 });
BookingSchema.index({ createdAt: -1 });

const PaymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'PENDING',
        'AUTHORIZED',
        'CAPTURED',
        'FAILED',
        'REFUNDED',
        'PARTIALLY_REFUNDED',
      ],
      default: 'PENDING',
    },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    provider: { type: String, default: 'APL_MOCK_PAY' },
    providerRef: { type: String },
    method: { type: String },
    last4: { type: String },
  },
  { timestamps: true },
);

module.exports = {
  Booking: mongoose.models.Booking || mongoose.model('Booking', BookingSchema),
  Payment: mongoose.models.Payment || mongoose.model('Payment', PaymentSchema),
};
