'use strict';

const { mongoose } = require('../../common/database/connection');
const { CancellationStatus } = require('../../payments/status');

const CancellationRequestSchema = new mongoose.Schema(
  {
    cancellationRef: { type: String, required: true, unique: true, index: true },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    aplBookingRef: { type: String, required: true, index: true },
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    requestedBy: {
      type: String,
      enum: ['CUSTOMER', 'DSA_ADMIN', 'APL_ADMIN', 'SYSTEM'],
      default: 'CUSTOMER',
    },
    reason: { type: String, default: '', maxlength: 1000 },
    status: {
      type: String,
      enum: Object.values(CancellationStatus),
      default: CancellationStatus.REQUESTED,
      index: true,
    },
    requestId: { type: String, index: true },
    /** Idempotency for cancel requests on the same booking. */
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
    supplierCancellationRef: { type: String },
    supplierStatus: { type: String },
    failureReason: { type: String },
    refundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Refund',
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

CancellationRequestSchema.index({ dsaId: 1, createdAt: -1 });
CancellationRequestSchema.index(
  { bookingId: 1, status: 1 },
  { partialFilterExpression: { status: { $in: ['REQUESTED', 'PROCESSING'] } } },
);

module.exports =
  mongoose.models.CancellationRequest ||
  mongoose.model('CancellationRequest', CancellationRequestSchema);
