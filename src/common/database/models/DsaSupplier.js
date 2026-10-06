'use strict';

const { mongoose } = require('../connection');

/**
 * Per-DSA supplier assignment for a master Service (Phase 10).
 * APLAdmin owns this mapping. Priority is lower-number-first (1 = highest).
 */
const DsaSupplierSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    enabled: { type: Boolean, default: true, index: true },
    priority: { type: Number, required: true, min: 1, max: 1000, default: 100 },
    /**
     * Explicit routing strategy for this DSA+service set.
     * Stored on each row for convenience; router uses the max-priority-enabled row's strategy
     * or a dedicated group default — see supplier-routing.service.
     */
    routingStrategy: {
      type: String,
      enum: ['PARALLEL', 'PRIORITY', 'FALLBACK'],
      default: 'PARALLEL',
    },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true },
);

DsaSupplierSchema.index(
  { dsaId: 1, serviceId: 1, supplierId: 1 },
  { unique: true },
);
DsaSupplierSchema.index({ dsaId: 1, serviceId: 1, priority: 1 });

module.exports =
  mongoose.models.DsaSupplier || mongoose.model('DsaSupplier', DsaSupplierSchema);
