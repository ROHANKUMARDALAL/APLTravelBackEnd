'use strict';

const mongoose = require('mongoose');
const { DSA_STATUSES } = require('../constants/tenant');

const AddressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, default: '' },
    line2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const BusinessSchema = new mongoose.Schema(
  {
    businessType: { type: String, trim: true, default: '' },
    ticketMode: { type: String, trim: true, default: '' },
    bookingPrefix: { type: String, trim: true, default: '' },
    currency: { type: String, trim: true, default: '' },
    countryCode: { type: String, trim: true, default: '' },
    dsaClass: { type: String, trim: true, default: '' },
    combineFare: { type: Boolean, default: false },
  },
  { _id: false },
);

const TaxSchema = new mongoose.Schema(
  {
    gstNumber: { type: String, trim: true, default: '' },
    panNumber: { type: String, trim: true, default: '' },
    panName: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const WebsiteAccessSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, default: '' },
    tokenPrefix: { type: String, default: '' },
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
    createdAt: { type: Date },
    rotatedAt: { type: Date },
  },
  { _id: false },
);

const ContactPersonSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    designation: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const DsaSchema = new mongoose.Schema(
  {
    dsaCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^APL-DSA-\d{4,}$/, 'dsaCode must look like APL-DSA-0001'],
    },
    companyName: { type: String, required: true, trim: true, maxlength: 200 },
    displayName: { type: String, required: true, trim: true, maxlength: 200 },
    ownerName: { type: String, required: true, trim: true, maxlength: 160 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    landline: { type: String, trim: true, default: '' },
    address: { type: AddressSchema, default: () => ({}) },
    business: { type: BusinessSchema, default: () => ({}) },
    tax: { type: TaxSchema, default: () => ({}) },
    contactPerson: { type: ContactPersonSchema, default: () => ({}) },
    remark: { type: String, trim: true, default: '' },
    domain: { type: String, trim: true, lowercase: true, default: '', maxlength: 253 },
    subdomain: { type: String, trim: true, lowercase: true, default: '', maxlength: 63 },
    customDomains: { type: [String], default: undefined },
    websiteAccess: { type: WebsiteAccessSchema, default: undefined },
    status: {
      type: String,
      enum: DSA_STATUSES,
      required: true,
      default: 'ACTIVE',
      index: true,
    },
    config: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true },
);

DsaSchema.index({ email: 1 });
DsaSchema.index({ status: 1, createdAt: -1 });
DsaSchema.index(
  { subdomain: 1 },
  { unique: true, partialFilterExpression: { subdomain: { $gt: '' } } },
);
DsaSchema.index(
  { domain: 1 },
  { unique: true, partialFilterExpression: { domain: { $gt: '' } } },
);
DsaSchema.index(
  { customDomains: 1 },
  { unique: true, sparse: true },
);

module.exports = mongoose.models.Dsa || mongoose.model('Dsa', DsaSchema);
module.exports.DSA_STATUSES = DSA_STATUSES;
module.exports.DsaSchema = DsaSchema;
