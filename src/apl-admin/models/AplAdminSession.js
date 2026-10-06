'use strict';

const { mongoose } = require('../../common/database/connection');

/**
 * APLAdmin opaque-token session. Raw token is never stored.
 * TTL index on expiresAt cleans expired sessions.
 */
const AplAdminSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AplAdminUser',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AplAdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AplAdminSessionSchema.index({ userId: 1, revokedAt: 1 });

module.exports =
  mongoose.models.AplAdminSession ||
  mongoose.model('AplAdminSession', AplAdminSessionSchema);
