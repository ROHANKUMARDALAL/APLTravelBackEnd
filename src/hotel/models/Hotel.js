'use strict';

const { mongoose } = require('../../common/database/connection');

const HotelOfferSchema = new mongoose.Schema(
  {
    aplOfferId: { type: String, required: true },
    supplierCode: {
      type: String,
      enum: ['TBO', 'TRIPJACK', 'KAFILA'],
      required: true,
    },
    supplierOfferId: { type: String, required: true },
    supplierHotelId: { type: String, required: true },
    supplierReference: { type: String },
    roomName: { type: String, required: true },
    mealPlan: { type: String },
    refundable: { type: Boolean, default: false },
    supplierAmount: { type: Number, required: true },
    supplierCurrency: { type: String, required: true },
    customerAmount: { type: Number, required: true },
    customerCurrency: { type: String, required: true },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    rawSnapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const HotelSchema = new mongoose.Schema(
  {
    aplHotelId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    normalizedName: { type: String, required: true, index: true },
    addressLine1: { type: String },
    cityName: { type: String, index: true },
    countryName: { type: String },
    countryIso2: { type: String },
    postalCode: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    phone: { type: String },
    starRating: { type: Number },
    offers: { type: [HotelOfferSchema], default: [] },
  },
  { timestamps: true },
);

HotelSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model('Hotel', HotelSchema);
