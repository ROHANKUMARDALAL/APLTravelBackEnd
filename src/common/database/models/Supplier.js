'use strict';

const { mongoose } = require('../connection');

/**
 * Global supplier catalog (Phase 10).
 * Stable codes (TBO, TRIPJACK, …). Secrets are never stored here —
 * only credentialRef / credentialsConfigured metadata.
 */
const SupplierSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 40,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'],
      default: 'ACTIVE',
      index: true,
    },
    isMock: { type: Boolean, default: true },
    /** Environments this supplier record may operate in. */
    environments: {
      type: [String],
      enum: ['TEST', 'LIVE'],
      default: ['TEST'],
    },
    /** APL-selected default environment for adapters (not a B2C parameter). */
    defaultEnvironment: {
      type: String,
      enum: ['TEST', 'LIVE'],
      default: 'TEST',
    },
    /**
     * Reference only — e.g. env var prefix SUPPLIER_TBO.
     * Actual secrets stay in deployment env / secret store.
     */
    credentialRef: { type: String, default: '', maxlength: 120 },
    credentialsConfigured: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

SupplierSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema);
