'use strict';

const { mongoose } = require('../../common/database/connection');
const { RefundStatus } = require('../../payments/status');

const RefundSchema = new mongoose.Schema(
  {
    refundRef: { type: String, required: true, unique: true, index: true },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    cancellationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CancellationRequest',
      index: true,
    },
    aplBookingRef: { type: String, index: true },
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
    requestId: { type: String, index: true },
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
    kind: {
      type: String,
      enum: ['FULL', 'PARTIAL'],
      default: 'FULL',
    },
    requestedAmount: { type: Number, required: true },
    approvedAmount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(RefundStatus),
      default: RefundStatus.REQUESTED,
      index: true,
    },
    provider: { type: String, default: 'APL_MOCK_PAY' },
    providerRefundRef: { type: String },
    reason: { type: String, default: '', maxlength: 1000 },
    failureReason: { type: String },
    /** Breakdown derived from commercialSnapshot (mock rules). */
    breakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    providerMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

RefundSchema.index({ dsaId: 1, createdAt: -1 });
RefundSchema.index({ bookingId: 1, createdAt: -1 });

module.exports =
  mongoose.models.Refund || mongoose.model('Refund', RefundSchema);
