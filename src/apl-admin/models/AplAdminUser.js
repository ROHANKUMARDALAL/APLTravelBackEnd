'use strict';

const { mongoose } = require('../../common/database/connection');

const ADMIN_STATUSES = ['ACTIVE', 'DISABLED'];

const AplAdminUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
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

module.exports =
  mongoose.models.AplAdminUser ||
  mongoose.model('AplAdminUser', AplAdminUserSchema);
module.exports.ADMIN_STATUSES = ADMIN_STATUSES;
