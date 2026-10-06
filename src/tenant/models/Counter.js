'use strict';

const { mongoose } = require('../../common/database/connection');

/**
 * Atomic counters for stable sequential identifiers (e.g. DSA codes).
 * findByIdAndUpdate + $inc is safe under concurrent creates.
 */
const CounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

module.exports =
  mongoose.models.Counter || mongoose.model('Counter', CounterSchema);
