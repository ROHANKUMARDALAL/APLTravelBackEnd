'use strict';

const { mongoose } = require('../../common/database/connection');

/**
 * Tenant-scoped supplier secrets. Ciphertext only.
 * Ordinary DsaSupplier rows store the reference, never the secret.
 */
const SupplierCredentialSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    environment: { type: String, enum: ['TEST', 'LIVE'], required: true },
    ownership: { type: String, enum: ['APL', 'CLIENT'], required: true },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
    keyVersion: { type: Number, default: 1 },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    ciphertext: { type: String, required: true },
    configured: { type: Boolean, default: true },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);

SupplierCredentialSchema.index(
  { dsaId: 1, supplierId: 1, environment: 1, ownership: 1 },
  { unique: true },
);

module.exports = mongoose.models.SupplierCredential
  || mongoose.model('SupplierCredential', SupplierCredentialSchema);
