'use strict';

const { mongoose } = require('../connection');

/**
 * Supplier ↔ master Service enablement (Phase 10).
 * Does not duplicate Service documents.
 */
const SupplierServiceSchema = new mongoose.Schema(
  {
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    enabled: { type: Boolean, default: true, index: true },
    /** Optional per-mapping environment override (null = use supplier default). */
    environment: {
      type: String,
      enum: ['TEST', 'LIVE', null],
      default: null,
    },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true },
);

SupplierServiceSchema.index({ supplierId: 1, serviceId: 1 }, { unique: true });

module.exports =
  mongoose.models.SupplierService ||
  mongoose.model('SupplierService', SupplierServiceSchema);
