'use strict';

const { mongoose } = require('../../common/database/connection');

const RechargeOrderSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    journeyId: { type: String, required: true, index: true },
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    idempotencyKey: { type: String, required: true },
    category: {
      type: String,
      enum: ['MOBILE', 'BROADBAND', 'ELECTRICITY', 'GAS', 'METRO'],
      required: true,
    },
    status: {
      type: String,
      enum: ['VALIDATED', 'SUCCESS', 'FAILED', 'PENDING'],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    providerCode: { type: String },
    providerName: { type: String },
    accountMasked: { type: String },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    test: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

RechargeOrderSchema.index({ dsaId: 1, idempotencyKey: 1 }, { unique: true });
RechargeOrderSchema.index({ dsaId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.models.RechargeOrder || mongoose.model('RechargeOrder', RechargeOrderSchema);
