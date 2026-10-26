'use strict';

const { config } = require('../../common/config');

/**
 * Phase 20 supplier execution.
 *
 * The DsaSupplier schema stores one routingStrategy enum and cannot express a
 * separate fallback trigger. These semantics are therefore explicit:
 *
 * PARALLEL — call every eligible supplier, bounded by concurrency and timeout.
 *            One failure does not discard other successes.
 * PRIORITY  — call in priority order. Stop at the first business-success that
 *            contains at least one usable offer. Errors, timeouts, business
 *            failures, and successful empty results continue to the next supplier.
 * FALLBACK  — call in priority order. Move on only when the attempt fails
 *            (exception, timeout, or business failure, including HTTP 200).
 *            A successful empty result is a completed answer and does not
 *            continue. This is the difference from PRIORITY.
 *
 * Downstream fare confirm, SSR, block, and book do not use this executor.
 */

function withTimeout(work, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Supplier timed out');
      error.code = 'SUPPLIER_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(work), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function failedOutcome(error, started) {
  const timeout = error?.code === 'SUPPLIER_TIMEOUT';
  return {
    status: timeout ? 'TIMEOUT' : 'FAILED',
    durationMs: Date.now() - started,
    errorCode: timeout ? 'SUPPLIER_TIMEOUT' : error?.code || 'SUPPLIER_EXCEPTION',
    errorMessage: error?.message || 'Supplier failed',
  };
}

async function callSupplier(entry, invoke, timeoutMs) {
  const started = Date.now();
  try {
    const outcome = await withTimeout(() => invoke(entry), timeoutMs);
    return {
      entry,
      adapter: entry.adapter,
      supplierId: entry.supplierId || null,
      outcome: outcome || { status: 'FAILED', errorCode: 'EMPTY_SUPPLIER_RESULT', errorMessage: 'Supplier returned no result' },
      called: true,
    };
  } catch (error) {
    return {
      entry,
      adapter: entry.adapter,
      supplierId: entry.supplierId || null,
      outcome: failedOutcome(error, started),
      called: true,
    };
  }
}

async function executeSupplierPlan(plan, options = {}) {
  const suppliers = Array.isArray(plan?.suppliers) ? plan.suppliers : [];
  const strategy = String(plan?.strategy || 'PARALLEL').toUpperCase();
  const timeoutMs = options.timeoutMs || config.supplierHttpTimeoutMs;
  const concurrency = options.concurrency || config.supplierSearchConcurrency || 4;
  const isUsable = options.isUsable || ((outcome) => outcome?.status === 'SUCCESS');
  const invoke = options.invoke;
  if (typeof invoke !== 'function') {
    throw new Error('executeSupplierPlan requires invoke');
  }

  if (strategy === 'PARALLEL') {
    const settled = await mapPool(suppliers, Math.max(1, concurrency), (entry) => (
      callSupplier(entry, invoke, timeoutMs)
    ));
    return { strategy, settled, skipped: [] };
  }

  const settled = [];
  const skipped = [];
  for (let index = 0; index < suppliers.length; index += 1) {
    const result = await callSupplier(suppliers[index], invoke, timeoutMs);
    const outcome = result.outcome || {};
    const failed = outcome.status !== 'SUCCESS';
    const usable = !failed && isUsable(outcome) === true;
    result.decision = failed
      ? (outcome.errorCode || outcome.status || 'FAILED')
      : (usable ? 'USABLE' : 'EMPTY_RESULT');
    settled.push(result);
    const rest = suppliers.slice(index + 1);
    if (usable || (strategy === 'FALLBACK' && !failed)) {
      const reason = usable ? 'STOPPED_AFTER_USABLE_RESULT' : 'STOPPED_AFTER_EMPTY_SUCCESS';
      rest.forEach((entry) => skipped.push({
        supplierCode: entry.supplierCode,
        reason,
      }));
      break;
    }
  }
  return { strategy, settled, skipped };
}

module.exports = { executeSupplierPlan };
