'use strict';

const mongoose = require('mongoose');
const { HOLIDAY_PACKAGE_STATUSES } = require('../constants/services');

const ItineraryDaySchema = new mongoose.Schema(
  {
    dayNumber: { type: Number, required: true, min: 1 },
    title: { type: String, trim: true, default: '', maxlength: 160 },
    description: { type: String, trim: true, default: '', maxlength: 4000 },
    activities: { type: [String], default: [] },
    images: { type: [String], default: [] },
  },
  { _id: false },
);

const HolidayPackageSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    packageCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 180 },
    shortDescription: { type: String, trim: true, default: '', maxlength: 400 },
    fullDescription: { type: String, trim: true, default: '', maxlength: 8000 },
    destinationCountry: { type: String, trim: true, default: '', maxlength: 80 },
    destinationState: { type: String, trim: true, default: '', maxlength: 80 },
    destinationCity: { type: String, trim: true, default: '', maxlength: 80 },
    destinations: { type: [String], default: [] },
    isInternational: { type: Boolean, required: true, default: false },
    durationDays: { type: Number, required: true, min: 1 },
    durationNights: { type: Number, required: true, min: 0 },
    startingPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, default: 'INR', maxlength: 3 },
    priceType: { type: String, enum: ['INDICATIVE', 'FIXED'], default: 'INDICATIVE' },
    /** Holiday product line. Missing values stay holiday; nothing is migrated to group departure. */
    packageCategory: { type: String, enum: ['HOLIDAY', 'GROUP_DEPARTURE'], default: 'HOLIDAY' },
    packageImages: { type: [String], default: [] },
    coverImage: { type: String, trim: true, default: '' },
    highlights: { type: [String], default: [] },
    inclusions: { type: [String], default: [] },
    exclusions: { type: [String], default: [] },
    itinerary: { type: [ItineraryDaySchema], default: [] },
    hotelInformation: { type: String, trim: true, default: '', maxlength: 4000 },
    transportationInformation: { type: String, trim: true, default: '', maxlength: 4000 },
    mealsIncluded: { type: String, trim: true, default: '', maxlength: 500 },
    availableTravelDates: { type: [String], default: [] },
    bookingTerms: { type: String, trim: true, default: '', maxlength: 4000 },
    cancellationPolicy: { type: String, trim: true, default: '', maxlength: 4000 },
    termsAndConditions: { type: String, trim: true, default: '', maxlength: 8000 },
    enquiryEnabled: { type: Boolean, default: true },
    status: { type: String, enum: HOLIDAY_PACKAGE_STATUSES, default: 'DRAFT', index: true },
    displayOrder: { type: Number, default: 100 },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

HolidayPackageSchema.index({ dsaId: 1, slug: 1 }, { unique: true });
HolidayPackageSchema.index({ dsaId: 1, packageCode: 1 }, { unique: true });
HolidayPackageSchema.index({ dsaId: 1, status: 1, displayOrder: 1 });

module.exports =
  mongoose.models.HolidayPackage || mongoose.model('HolidayPackage', HolidayPackageSchema);
module.exports.HolidayPackageSchema = HolidayPackageSchema;
