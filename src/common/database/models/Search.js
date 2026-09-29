'use strict';

const { mongoose } = require('../connection');

const SearchSupplierResultSchema = new mongoose.Schema(
  {
    supplierCode: {
      type: String,
      enum: ['TBO', 'TRIPJACK', 'KAFILA'],
      required: true,
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED'],
      required: true,
    },
    durationMs: { type: Number },
    errorCode: { type: String },
    errorMessage: { type: String },
    rawResultCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const SearchSchema = new mongoose.Schema(
  {
    aplSearchId: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: ['HOTEL', 'FLIGHT'],
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PARTIAL', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    request: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Cached canonical results for details / revalidate / checkout. */
    results: { type: mongoose.Schema.Types.Mixed, default: null },
    resultCount: { type: Number, default: 0 },
    supplierResults: { type: [SearchSupplierResultSchema], default: [] },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

SearchSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.models.Search || mongoose.model('Search', SearchSchema);
