'use strict';

const { mongoose } = require('../connection');

/**
 * Larger supplier payloads (Phase 10).
 * ServiceLog stores lifecycle metadata + payloadRef pointing here when needed.
 */
const SupplierRawPayloadSchema = new mongoose.Schema(
  {
    supplierCode: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    searchId: { type: String, index: true },
    requestId: { type: String, index: true },
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      index: true,
    },
    operation: { type: String, required: true },
    stage: {
      type: String,
      enum: [
        'SUPPLIER_REQUEST',
        'SUPPLIER_RESPONSE',
        'NORMALIZED_RESPONSE',
        'OTHER',
      ],
      default: 'SUPPLIER_RESPONSE',
    },
    externalRef: { type: String },
    /** Redacted/sanitized payload only. */
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    byteLength: { type: Number },
    truncated: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

SupplierRawPayloadSchema.index({ dsaId: 1, createdAt: -1 });
SupplierRawPayloadSchema.index({ requestId: 1, createdAt: 1 });

// Operational retention foundation (days). Override via env at boot if needed.
const retentionDays = Number(process.env.SUPPLIER_RAW_PAYLOAD_RETENTION_DAYS || 30);
if (Number.isFinite(retentionDays) && retentionDays > 0) {
  SupplierRawPayloadSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: Math.floor(retentionDays * 24 * 60 * 60) },
  );
}

module.exports =
  mongoose.models.SupplierRawPayload ||
  mongoose.model('SupplierRawPayload', SupplierRawPayloadSchema);
