'use strict';

const { mongoose } = require('../connection');

const SupplierMappingSchema = new mongoose.Schema(
  {
    supplierCode: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    entityType: { type: String, required: true, index: true },
    aplEntityId: { type: String, required: true, index: true },
    supplierEntityId: { type: String, required: true },
    supplierOfferId: { type: String },
    supplierReference: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

SupplierMappingSchema.index(
  { supplierCode: 1, entityType: 1, supplierEntityId: 1 },
  { unique: true },
);

module.exports = mongoose.model('SupplierMapping', SupplierMappingSchema);
