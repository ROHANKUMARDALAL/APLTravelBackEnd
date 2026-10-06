'use strict';

const { mongoose } = require('../connection');

const LIFECYCLE_STAGES = [
  'INBOUND_REQUEST',
  'NORMALIZED_REQUEST',
  'SUPPLIER_REQUEST',
  'SUPPLIER_RESPONSE',
  'NORMALIZED_RESPONSE',
  'OUTBOUND_RESPONSE',
  'ERROR',
  // Phase 13 — payment / booking confirm / cancellation / refund
  'PAYMENT_CREATED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'BOOKING_CONFIRM_ATTEMPT',
  'BOOKING_CONFIRMED',
  'BOOKING_FAILED',
  'CANCELLATION_REQUESTED',
  'CANCELLATION_CONFIRMED',
  'CANCELLATION_FAILED',
  'REFUND_REQUESTED',
  'REFUND_SUCCESS',
  'REFUND_FAILED',
];

/**
 * Request lifecycle + supplier branch logs (Phase 10).
 * Large payloads live in SupplierRawPayload; this record holds metadata + refs.
 */
const ServiceLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, index: true },
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    /** Legacy direction kept for Phase 1–9 readers. */
    direction: { type: String, enum: ['INBOUND', 'SUPPLIER'], required: true },
    stage: {
      type: String,
      enum: LIFECYCLE_STAGES,
      index: true,
    },
    service: { type: String, required: true, index: true },
    operation: { type: String, required: true },
    supplierCode: { type: String, index: true },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      index: true,
    },
    searchId: { type: String, index: true },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PARTIAL', 'SKIPPED'],
      index: true,
    },
    httpStatus: { type: Number },
    durationMs: { type: Number },
    /** Small redacted snapshot (trimmed). Prefer payloadRef for large bodies. */
    request: { type: mongoose.Schema.Types.Mixed },
    supplierRequest: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
    payloadRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupplierRawPayload',
    },
    errorCode: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ServiceLogSchema.index({ dsaId: 1, createdAt: -1 });
ServiceLogSchema.index({ dsaId: 1, service: 1, createdAt: -1 });
ServiceLogSchema.index({ requestId: 1, createdAt: 1 });
ServiceLogSchema.index({ stage: 1, createdAt: -1 });
ServiceLogSchema.index({ supplierCode: 1, createdAt: -1 });

const logRetentionDays = Number(process.env.SERVICE_LOG_RETENTION_DAYS || 90);
if (Number.isFinite(logRetentionDays) && logRetentionDays > 0) {
  ServiceLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: Math.floor(logRetentionDays * 24 * 60 * 60) },
  );
}

module.exports =
  mongoose.models.ServiceLog || mongoose.model('ServiceLog', ServiceLogSchema);
module.exports.LIFECYCLE_STAGES = LIFECYCLE_STAGES;
