'use strict';

const mongoose = require('mongoose');
const { SERVICE_GLOBAL_STATUSES, SERVICE_MODES } = require('../constants/services');

const ServiceSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 64,
      match: [/^[a-z][a-z0-9_-]*$/, 'code must be lowercase alphanumeric'],
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    icon: { type: String, trim: true, default: '', maxlength: 80 },
    globalStatus: {
      type: String,
      enum: SERVICE_GLOBAL_STATUSES,
      required: true,
      default: 'ACTIVE',
      index: true,
    },
    displayOrder: { type: Number, required: true, default: 100, min: 0 },
    /**
     * How the storefront should treat the service.
     * API_BOOKING does not mean a live supplier is connected.
     */
    serviceMode: {
      type: String,
      enum: SERVICE_MODES,
      default: undefined,
    },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true },
);

ServiceSchema.index({ globalStatus: 1, displayOrder: 1 });

module.exports = mongoose.models.Service || mongoose.model('Service', ServiceSchema);
module.exports.SERVICE_GLOBAL_STATUSES = SERVICE_GLOBAL_STATUSES;
module.exports.ServiceSchema = ServiceSchema;
