'use strict';

const { mongoose } = require('../../common/database/connection');

const ADMIN_STATUSES = ['ACTIVE', 'DISABLED'];

/**
 * DSAAdmin identity — always bound to exactly one DSA tenant.
 */
const DsaAdminUserSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      // Global unique so email/password login resolves a single tenant unambiguously.
      unique: true,
    },
    phone: { type: String, trim: true, default: '', maxlength: 40 },
    passwordHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ADMIN_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminRole',
      required: true,
      index: true,
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DsaAdminUserSchema.index({ dsaId: 1, status: 1 });

module.exports =
  mongoose.models.DsaAdminUser ||
  mongoose.model('DsaAdminUser', DsaAdminUserSchema);
module.exports.ADMIN_STATUSES = ADMIN_STATUSES;
