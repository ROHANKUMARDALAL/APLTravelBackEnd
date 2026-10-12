'use strict';

const { mongoose } = require('../../common/database/connection');

const WalletTransactionSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'DsaCustomerMembership', index: true },
    amount: { type: Number, required: true },
    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    type: { type: String, required: true },
    currency: { type: String, default: 'INR' },
    reference: { type: String, default: '' },
    reason: { type: String, default: '' },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports =
  mongoose.models.WalletTransaction ||
  mongoose.model('WalletTransaction', WalletTransactionSchema);
