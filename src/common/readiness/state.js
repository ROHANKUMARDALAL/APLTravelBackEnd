'use strict';

/**
 * Process readiness state (Phase 15).
 * Liveness (/health) means the Node process can answer.
 * Readiness (/ready) means dependencies + bootstrap finished.
 */

const state = {
  processStartedAt: new Date().toISOString(),
  databaseConnected: false,
  initComplete: false,
  httpListening: false,
  lastDatabaseError: null,
  readyAt: null,
};

function markDatabaseConnected(ok = true, error = null) {
  state.databaseConnected = Boolean(ok);
  state.lastDatabaseError = ok ? null : String(error || 'database unavailable');
  if (!ok) {
    state.readyAt = null;
  }
  refreshReadyAt();
}

function markInitComplete(ok = true) {
  state.initComplete = Boolean(ok);
  refreshReadyAt();
}

function markHttpListening(ok = true) {
  state.httpListening = Boolean(ok);
  refreshReadyAt();
}

function refreshReadyAt() {
  if (state.databaseConnected && state.initComplete && state.httpListening) {
    if (!state.readyAt) state.readyAt = new Date().toISOString();
  } else {
    state.readyAt = null;
  }
}

function getReadinessSnapshot() {
  const checks = {
    databaseConnected: state.databaseConnected,
    initComplete: state.initComplete,
    httpListening: state.httpListening,
  };
  const ready =
    checks.databaseConnected && checks.initComplete && checks.httpListening;
  const pending = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  let reason = 'READY';
  if (!ready) {
    if (!checks.httpListening && !checks.initComplete) {
      reason = 'STARTING';
    } else if (!checks.databaseConnected) {
      reason = 'DEPENDENCY_UNAVAILABLE';
    } else {
      reason = 'NOT_READY';
    }
  }

  return {
    service: 'apl-travel-backend',
    ready,
    reason,
    processStartedAt: state.processStartedAt,
    readyAt: state.readyAt,
    checks,
    pending,
    lastDatabaseError: state.lastDatabaseError,
    timestamp: new Date().toISOString(),
  };
}

function isApplicationReady() {
  return getReadinessSnapshot().ready;
}

module.exports = {
  markDatabaseConnected,
  markInitComplete,
  markHttpListening,
  getReadinessSnapshot,
  isApplicationReady,
};
