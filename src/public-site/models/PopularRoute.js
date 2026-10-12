'use strict';

const { mongoose } = require('../../common/database/connection');

const PopularRouteSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    serviceCode: { type: String, required: true, lowercase: true, default: 'flight' },
    originCode: { type: String, uppercase: true, trim: true, default: '' },
    destinationCode: { type: String, uppercase: true, trim: true, default: '' },
    originName: { type: String, default: '' },
    destinationName: { type: String, default: '' },
    airlineCode: { type: String, default: null },
    airlineName: { type: String, default: '' },
    tripType: { type: String, default: 'ONEWAY' },
    searchDefaults: {
      departOffsetDays: { type: Number, default: 7 },
      adults: { type: Number, default: 1 },
      guests: { type: Number, default: 2 },
      rooms: { type: Number, default: 1 },
      stayNights: { type: Number, default: 1 },
      passengers: { type: Number, default: 1 },
      pickupTime: { type: String, default: '10:00' },
      pickupKind: { type: String, default: '' },
      dropoffKind: { type: String, default: '' },
    },
    displayTitle: { type: String, default: '' },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false },
    priority: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.PopularRoute || mongoose.model('PopularRoute', PopularRouteSchema);
