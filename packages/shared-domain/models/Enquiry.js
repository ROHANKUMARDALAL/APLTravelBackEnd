'use strict';

const mongoose = require('mongoose');
const { ENQUIRY_STATUSES } = require('../constants/services');

const PassengerDocumentSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true, default: '' },
    /** AES-GCM ciphertext. Never log or return this field by default. */
    numberEnc: { type: String, default: '' },
    holderName: { type: String, trim: true, default: '' },
    nationality: { type: String, trim: true, default: '' },
    dateOfBirth: { type: String, trim: true, default: '' },
    expiryDate: { type: String, trim: true, default: '' },
    issuingCountry: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const PassengerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    dateOfBirth: { type: String, trim: true, default: '' },
    age: { type: Number, min: 0, max: 120 },
    gender: { type: String, trim: true, default: '' },
    nationality: { type: String, trim: true, default: '' },
    document: { type: PassengerDocumentSchema, default: () => ({}) },
  },
  { _id: false },
);

const ActivitySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    actorId: { type: String, default: '' },
    actorName: { type: String, default: '' },
    action: { type: String, required: true },
    fromStatus: { type: String, default: '' },
    toStatus: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 2000 },
  },
  { _id: false },
);

const EnquirySchema = new mongoose.Schema(
  {
    enquiryReference: { type: String, required: true, unique: true, trim: true },
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    serviceCode: { type: String, required: true, trim: true, lowercase: true, index: true },
    /** Set only when a holiday enquiry is explicitly a group departure. Empty keeps historical rows as holiday. */
    enquiryCategory: { type: String, enum: ['', 'HOLIDAY', 'GROUP_DEPARTURE'], default: '' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerMembershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'DsaCustomerMembership' },
    customerSnapshot: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      customerCode: { type: String, default: '' },
    },
    holidayPackageId: { type: mongoose.Schema.Types.ObjectId, ref: 'HolidayPackage' },
    holidayPackageSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    preferredDepartureDate: { type: String, default: '' },
    durationDays: { type: Number, default: 0 },
    adults: { type: Number, default: 0 },
    children: { type: Number, default: 0 },
    totalPassengers: { type: Number, default: 0 },
    passengers: { type: [PassengerSchema], default: [] },
    contactDetails: {
      name: { type: String, default: '' },
      mobile: { type: String, default: '' },
      email: { type: String, default: '' },
    },
    specialRequirements: { type: String, default: '', maxlength: 4000 },
    status: { type: String, enum: ENQUIRY_STATUSES, default: 'NEW', index: true },
    assignedTo: { type: String, default: '' },
    adminNotes: { type: String, default: '', maxlength: 8000 },
    customerVisibleRemarks: { type: String, default: '', maxlength: 4000 },
    idempotencyKey: { type: String, default: '' },
    /**
     * Identity document ciphertext is cleared after this date.
     * Contact and package snapshot are kept so the enquiry history stays readable.
     */
    retentionDeleteAfter: { type: Date },
    activity: { type: [ActivitySchema], default: [] },
  },
  { timestamps: true },
);

EnquirySchema.index({ dsaId: 1, createdAt: -1 });
EnquirySchema.index({ dsaId: 1, customerId: 1, createdAt: -1 });
EnquirySchema.index({ dsaId: 1, status: 1, createdAt: -1 });
EnquirySchema.index(
  { dsaId: 1, customerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } } },
);

module.exports = mongoose.models.Enquiry || mongoose.model('Enquiry', EnquirySchema);
module.exports.EnquirySchema = EnquirySchema;
