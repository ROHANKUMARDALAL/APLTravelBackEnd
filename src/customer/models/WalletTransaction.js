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
    grossAmount: { type: Number, default: 0 },
    feeAmount: { type: Number, default: 0 },
    method: { type: String, default: '' },
    paymentRef: { type: String, default: '' },
    bookingReference: { type: String, default: '' },
    serviceCode: { type: String, default: '', trim: true, lowercase: true },
    status: { type: String, default: 'SUCCESS' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

WalletTransactionSchema.index(
  { reference: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: { $in: ['ADD_MONEY', 'TOPUP_REVERSAL'] } },
  },
);
WalletTransactionSchema.index(
  { paymentRef: 1, type: 1 },
  {
    unique: true,
    name: 'wallet_booking_payment_once',
    partialFilterExpression: { type: { $in: ['BOOKING_DEBIT', 'BOOKING_REVERSAL'] } },
  },
);

module.exports =
  mongoose.models.WalletTransaction ||
  mongoose.model('WalletTransaction', WalletTransactionSchema);
