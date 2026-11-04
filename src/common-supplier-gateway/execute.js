'use strict';

const { selectLowestFlights, selectLowestHotels } = require('./aggregate');

const buckets = new Map();

function withinRateLimit(entry) {
  const limit = Number(entry.rateLimitPerMinute || 60);
  const key = `${entry.dsaId || 'na'}:${entry.supplierCode}`;
  const now = Date.now();
  const bucket = buckets.get(key) || [];
  const recent = bucket.filter((at) => now - at < 60_000);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

function withTimeout(work, ms, supplierCode) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SUPPLIER_TIMEOUT:${supplierCode}`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * Run only eligible, enabled, non-placeholder adapters.
 * One failure does not cancel the others.
 */
async function executeSupplierSearch({
  entries,
  invoke,
  timeoutMs = 8000,
  serviceCode = 'flight',
  markupPercent = 0,
}) {
  const called = [];
  const diagnostics = [];
  const offers = [];

  await Promise.all((entries || []).map(async (entry) => {
    if (!entry || entry.enabled === false || entry.status === 'DISABLED') {
      diagnostics.push({ supplierCode: entry?.supplierCode, status: 'SKIPPED', reason: 'DISABLED' });
      return;
    }
    if (entry.integrationStatus === 'PLACEHOLDER' || !entry.adapter) {
      diagnostics.push({
        supplierCode: entry.supplierCode,
        status: 'SKIPPED',
        reason: 'INTEGRATION_PENDING',
      });
      return;
    }
    if (!withinRateLimit(entry)) {
      diagnostics.push({ supplierCode: entry.supplierCode, status: 'SKIPPED', reason: 'RATE_LIMIT' });
      return;
    }
    called.push(entry.supplierCode);
    try {
      const result = await withTimeout(invoke(entry), timeoutMs, entry.supplierCode);
      const rows = Array.isArray(result) ? result : result?.offers || [];
      for (const row of rows) {
        offers.push({
          ...row,
          supplierCode: entry.supplierCode,
          supplierId: entry.supplierId,
          credentialConfigId: entry.credentialConfigId || '',
          credentialOwner: entry.credentialOwner || 'APL',
          environment: entry.environment || 'TEST',
        });
      }
      diagnostics.push({ supplierCode: entry.supplierCode, status: 'SUCCESS', count: rows.length });
    } catch (error) {
      diagnostics.push({
        supplierCode: entry.supplierCode,
        status: 'FAILED',
        errorCategory: String(error.message || 'SUPPLIER_ERROR').split(':')[0],
      });
    }
  }));

  const grouped = serviceCode === 'hotel'
    ? selectLowestHotels(offers, markupPercent)
    : selectLowestFlights(offers, markupPercent);
  return {
    offers: grouped.displayed,
    ungrouped: grouped.preserved,
    diagnostics,
    called,
  };
}

module.exports = { executeSupplierSearch };
