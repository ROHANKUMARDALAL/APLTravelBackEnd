'use strict';

const { mongoose } = require('../../common/database/connection');

/**
 * DSAAdmin opaque-token session. Includes trusted dsaId from login time.
 * Raw token is never stored.
 */
const DsaAdminSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DsaAdminUser',
      required: true,
      index: true,
    },
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
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

DsaAdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
DsaAdminSessionSchema.index({ userId: 1, revokedAt: 1 });

module.exports =
  mongoose.models.DsaAdminSession ||
  mongoose.model('DsaAdminSession', DsaAdminSessionSchema);
