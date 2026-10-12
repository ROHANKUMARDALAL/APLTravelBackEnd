'use strict';

const { mongoose } = require('../../common/database/connection');

const CouponRedemptionSchema = new mongoose.Schema(
  {
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    customerKey: { type: String, default: 'guest', index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['RESERVED', 'CONSUMED', 'RELEASED'], default: 'RESERVED' },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.CouponRedemption || mongoose.model('CouponRedemption', CouponRedemptionSchema);
