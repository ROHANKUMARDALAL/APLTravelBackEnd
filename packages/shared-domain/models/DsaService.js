'use strict';

const mongoose = require('mongoose');

/**
 * Field authority:
 *   isAllowedByAPL  — APLAdminBackEnd only
 *   isActiveByDSA   — DSAAdminBackEnd only
 */
const DsaServiceSchema = new mongoose.Schema(
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
    isAllowedByAPL: { type: Boolean, required: true, default: false },
    isActiveByDSA: { type: Boolean, required: true, default: false },
    displayOrder: { type: Number, default: null, min: 0 },
    settings: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true },
);

DsaServiceSchema.index({ dsaId: 1, serviceId: 1 }, { unique: true });
DsaServiceSchema.index({ dsaId: 1, isAllowedByAPL: 1, isActiveByDSA: 1 });

module.exports =
  mongoose.models.DsaService || mongoose.model('DsaService', DsaServiceSchema);
module.exports.DsaServiceSchema = DsaServiceSchema;
