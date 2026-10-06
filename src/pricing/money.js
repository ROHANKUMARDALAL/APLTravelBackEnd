'use strict';

/**
 * Money helpers (Phase 12).
 * All commercial math runs in integer minor units to avoid float drift.
 * Display/API amounts remain major units with exactly 2 decimal places.
 */

const SCALE = 100;

function toMinor(major) {
  const n = Number(major);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid money amount: ${major}`);
  }
  return Math.round(n * SCALE);
}

function toMajor(minor) {
  const n = Number(minor);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid minor amount: ${minor}`);
  }
  return Math.round(n) / SCALE;
}

/** Percentage of a minor base → minor (half-up via Math.round). */
function percentOfMinor(baseMinor, percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 0;
  return Math.round((baseMinor * p) / 100);
}

function money(amountMajor, currency) {
  return {
    amount: toMajor(toMinor(amountMajor)),
    currency: String(currency || 'INR').toUpperCase(),
  };
}

module.exports = {
  SCALE,
  toMinor,
  toMajor,
  percentOfMinor,
  money,
};
