'use strict';

const { mongoose } = require('../../common/database/connection');

const CustomerWalletTopUpSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    paymentRef: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, required: true },
    method: { type: String, required: true },
    currency: { type: String, default: 'INR' },
    grossAmount: { type: Number, required: true },
    feeAmount: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    rateBps: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'CREDITING', 'SUCCESS', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    provider: { type: String, default: 'APL_MOCK_PAY' },
    providerRef: { type: String, default: '' },
    demo: { type: Boolean, default: true },
    requestId: { type: String, default: '' },
    failureReason: { type: String, default: '' },
  },
  { timestamps: true, collection: 'customerwallettopups' },
);

CustomerWalletTopUpSchema.index({ dsaId: 1, userId: 1, idempotencyKey: 1 }, { unique: true });

module.exports =
  mongoose.models.CustomerWalletTopUp ||
  mongoose.model('CustomerWalletTopUp', CustomerWalletTopUpSchema);
