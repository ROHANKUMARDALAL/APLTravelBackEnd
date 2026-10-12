'use strict';

const { mongoose } = require('../../common/database/connection');

const CustomerWalletSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'DsaCustomerMembership', index: true },
    currency: { type: String, default: 'INR', uppercase: true },
    balance: { type: Number, default: 0 },
    totalCredits: { type: Number, default: 0 },
    totalDebits: { type: Number, default: 0 },
  },
  { timestamps: true },
);

CustomerWalletSchema.index({ dsaId: 1, userId: 1 }, { unique: true });

module.exports =
  mongoose.models.CustomerWallet || mongoose.model('CustomerWallet', CustomerWalletSchema);
