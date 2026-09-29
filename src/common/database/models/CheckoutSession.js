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
      enum: ['FLIGHT', 'HOTEL'],
      required: true,
    },
    searchId: { type: String, required: true, index: true },
    aplOfferId: { type: String, required: true },
    aplEntityId: { type: String },
    status: {
      type: String,
      enum: ['DRAFT', 'READY', 'BOOKED', 'EXPIRED', 'CANCELLED'],
      default: 'DRAFT',
    },
    contact: {
      email: { type: String },
      phone: { type: String },
      countryCode: { type: String, default: '+91' },
    },
    travellers: { type: [mongoose.Schema.Types.Mixed], default: [] },
    offerSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    pricing: {
      amount: { type: Number, required: true },
      currency: { type: String, required: true },
      baseAmount: { type: Number },
      addonsAmount: { type: Number },
    },
    expiresAt: { type: Date, required: true },
    aplBookingRef: { type: String },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.CheckoutSession ||
  mongoose.model('CheckoutSession', CheckoutSessionSchema);
