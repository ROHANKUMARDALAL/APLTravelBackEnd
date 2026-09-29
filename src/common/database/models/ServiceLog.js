'use strict';

const { mongoose } = require('../connection');

/**
 * Stored copy of an APL API call (INBOUND) or a supplier call (SUPPLIER).
 * Used to compare what the user sent with what was sent to TBO / TripJack / Kafila.
 */
const ServiceLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    direction: { type: String, enum: ['INBOUND', 'SUPPLIER'], required: true },
    service: { type: String, required: true, index: true },
    operation: { type: String, required: true },
    supplierCode: { type: String, index: true },
    searchId: { type: String, index: true },
    httpStatus: { type: Number },
    durationMs: { type: Number },
    request: { type: mongoose.Schema.Types.Mixed },
    supplierRequest: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
    errorCode: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports =
  mongoose.models.ServiceLog || mongoose.model('ServiceLog', ServiceLogSchema);
