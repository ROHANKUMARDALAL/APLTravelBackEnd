'use strict';

const { mongoose } = require('../../common/database/connection');

const MEMBERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'];

const DsaCustomerMembershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    customerCode: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: MEMBERSHIP_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    joinedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: null },
    referralCode: { type: String, trim: true, uppercase: true, default: '' },
  },
  { timestamps: true },
);

DsaCustomerMembershipSchema.index({ dsaId: 1, userId: 1 }, { unique: true });
DsaCustomerMembershipSchema.index({ customerCode: 1 }, { unique: true });
DsaCustomerMembershipSchema.index(
  { referralCode: 1 },
  { unique: true, partialFilterExpression: { referralCode: { $gt: '' } } },
);

module.exports =
  mongoose.models.DsaCustomerMembership ||
  mongoose.model('DsaCustomerMembership', DsaCustomerMembershipSchema);
module.exports.MEMBERSHIP_STATUSES = MEMBERSHIP_STATUSES;
