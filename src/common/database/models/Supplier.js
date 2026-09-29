'use strict';

const { mongoose } = require('../connection');

const SupplierSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: ['TBO', 'TRIPJACK', 'KAFILA'],
      required: true,
      unique: true,
    },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'],
      default: 'ACTIVE',
    },
    isMock: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Supplier', SupplierSchema);
