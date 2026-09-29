'use strict';

const { mongoose } = require('../connection');

const SupplierRawPayloadSchema = new mongoose.Schema(
  {
    supplierCode: {
      type: String,
      enum: ['TBO', 'TRIPJACK', 'KAFILA'],
      required: true,
      index: true,
    },
    searchId: { type: String, index: true },
    operation: { type: String, required: true },
    externalRef: { type: String },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports = mongoose.model('SupplierRawPayload', SupplierRawPayloadSchema);
