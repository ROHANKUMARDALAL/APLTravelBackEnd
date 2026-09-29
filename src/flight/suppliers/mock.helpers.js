'use strict';

/** Shared mock timing helpers for flight adapters. */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIata(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

module.exports = { delay, normalizeIata };
