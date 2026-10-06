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
    address: { type: AddressSchema, default: () => ({}) },
    domain: { type: String, trim: true, lowercase: true, default: '', maxlength: 253 },
    subdomain: { type: String, trim: true, lowercase: true, default: '', maxlength: 63 },
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

module.exports = mongoose.models.Dsa || mongoose.model('Dsa', DsaSchema);
module.exports.DSA_STATUSES = DSA_STATUSES;
module.exports.DsaSchema = DsaSchema;
