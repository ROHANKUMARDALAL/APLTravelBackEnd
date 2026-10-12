'use strict';

const { mongoose } = require('../../common/database/connection');

const CouponSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    serviceCode: { type: String, required: true, lowercase: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '', maxlength: 300 },
    adjustmentType: { type: String, enum: ['FIXED', 'PERCENTAGE'], required: true },
    value: { type: Number, required: true, min: 0 },
    currency: { type: String, uppercase: true, default: 'INR' },
    maxAmount: { type: Number, default: null, min: 0 },
    minAmount: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    totalLimit: { type: Number, default: null, min: 1 },
    perCustomerLimit: { type: Number, default: 1, min: 1 },
    customerIds: { type: [String], default: [] },
    originCode: { type: String, default: null },
    destinationCode: { type: String, default: null },
    exclusive: { type: Boolean, default: false },
    firstBookingOnly: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'EXPIRED'], default: 'ACTIVE' },
    usedCount: { type: Number, default: 0, min: 0 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CouponSchema.index({ dsaId: 1, serviceCode: 1, code: 1 }, { unique: true });

module.exports = mongoose.models.Coupon || mongoose.model('Coupon', CouponSchema);
