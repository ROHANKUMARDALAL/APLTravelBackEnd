'use strict';

const { mongoose } = require('../../common/database/connection');
const { ROLE_SCOPE } = require('../permissions');

const SCOPES = Object.values(ROLE_SCOPE);
const ROLE_STATUSES = ['ACTIVE', 'INACTIVE'];

/**
 * System roles for APLAdmin or DSAAdmin (scoped).
 * Unique on (scope, code) so APL SUPPORT ≠ DSA SUPPORT.
 */
const AdminRoleSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: SCOPES,
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    permissions: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    status: {
      type: String,
      enum: ROLE_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    isSystem: { type: Boolean, default: true },
  },
  { timestamps: true },
);

AdminRoleSchema.index({ scope: 1, code: 1 }, { unique: true });

module.exports =
  mongoose.models.AdminRole || mongoose.model('AdminRole', AdminRoleSchema);
module.exports.ROLE_STATUSES = ROLE_STATUSES;
