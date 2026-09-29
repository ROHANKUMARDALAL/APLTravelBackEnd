'use strict';

const { mongoose } = require('../../common/database/connection');

/**
 * Account history: payments, refunds, and cancellations for one user.
 */
const AccountActionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['PAYMENT', 'REFUND', 'CANCELLATION'],
      required: true,
    },
    direction: {
      type: String,
      enum: ['DEBIT', 'CREDIT', 'NONE'],
      required: true,
    },
    aplBookingRef: { type: String, index: true },
    productType: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    balanceAfter: { type: Number, required: true },
    paymentMethod: { type: String },
    paymentStatus: { type: String },
    note: { type: String },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.AccountAction || mongoose.model('AccountAction', AccountActionSchema);
