'use strict';

const Counter = require('../models/Counter');

const COUNTER_ID = 'dsaCode';

/**
 * Allocate the next unique DSA code using an atomic Mongo counter.
 * Concurrent creates cannot collide on the same sequence number.
 */
async function allocateDsaCode() {
  const counter = await Counter.findByIdAndUpdate(
    COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const seq = Number(counter.seq) || 0;
  return `APL-DSA-${String(seq).padStart(4, '0')}`;
}

module.exports = { allocateDsaCode, COUNTER_ID };
