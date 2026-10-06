'use strict';

const { mongoose } = require('../connection');

/**
 * OTA-style checkout session (MMT/Paytm-like).
 * Client receives checkoutToken after travellers are submitted; book uses that token.
 * No real payment gateway — mock capture only.
 */
const CheckoutSessionSchema = new mongoose.Schema(
  {
    checkoutToken: { type: String, required: true, unique: true, index: true },
    productType: {
      type: String,
      enum: ['FLIGHT', 'HOTEL', 'BUS', 'TRANSFER'],
      required: true,
    },
    searchId: { type: String, required: true, index: true },
    aplOfferId: { type: String, required: true },
    aplEntityId: { type: String },
    /** Trusted DSA captured at checkout (Phase 9+). Optional for legacy. */
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      index: true,
    },
    requestId: { type: String },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'READY',
        'PAYING',
        'BOOKED',
        'EXPIRED',
        'CANCELLED',
        /** Payment succeeded but supplier/local booking confirm failed. */
        'PAYMENT_CAPTURED_BOOKING_FAILED',
      ],
      default: 'DRAFT',
    },
    paymentRef: { type: String },
    contact: {
      email: { type: String },
      phone: { type: String },
      countryCode: { type: String, default: '+91' },
    },
    travellers: { type: [mongoose.Schema.Types.Mixed], default: [] },
    offerSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Immutable commercial calculation at checkout (Phase 12). */
    commercialSnapshot: { type: mongoose.Schema.Types.Mixed },
    pricing: {
      amount: { type: Number, required: true },
      currency: { type: String, required: true },
      baseAmount: { type: Number },
      addonsAmount: { type: Number },
      unitAmount: { type: Number },
      fareLabel: { type: String },
    },
    expiresAt: { type: Date, required: true },
    aplBookingRef: { type: String },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.CheckoutSession ||
  mongoose.model('CheckoutSession', CheckoutSessionSchema);
