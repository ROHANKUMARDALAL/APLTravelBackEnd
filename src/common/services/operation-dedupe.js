'use strict';

const inflight = new Map();
const recent = new Map();

function shareOperation(key, work) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      if (inflight.get(key) === pending) inflight.delete(key);
    });
  inflight.set(key, pending);
  return pending;
}

function recallOperation(key) {
  const row = recent.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    recent.delete(key);
    return null;
  }
  return row.value;
}

function rememberOperation(key, value, ttlMs) {
  recent.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

module.exports = {
  shareOperation,
  recallOperation,
  rememberOperation,
};
