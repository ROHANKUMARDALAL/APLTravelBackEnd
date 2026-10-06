'use strict';

const ServiceLog = require('../database/models/ServiceLog');
const SupplierRawPayload = require('../database/models/SupplierRawPayload');
const { redact } = require('../utils/redact');

const MAX_INLINE_CHARS = Number(process.env.SERVICE_LOG_INLINE_MAX_CHARS || 12_000);
const MAX_RAW_CHARS = Number(process.env.SUPPLIER_RAW_PAYLOAD_MAX_CHARS || 80_000);

function trimPayload(value, maxChars = MAX_INLINE_CHARS) {
  const clean = redact(value);
  const text = JSON.stringify(clean);
  if (!text || text.length <= maxChars) {
    return { value: clean, truncated: false, byteLength: text ? text.length : 0 };
  }
  return {
    value: { truncated: true, preview: text.slice(0, maxChars) },
    truncated: true,
    byteLength: text.length,
  };
}

async function storeRawPayload({
  supplierCode,
  searchId,
  requestId,
  dsaId,
  operation,
  stage,
  payload,
}) {
  const trimmed = trimPayload(payload, MAX_RAW_CHARS);
  try {
    const doc = await SupplierRawPayload.create({
      supplierCode: supplierCode ? String(supplierCode).toUpperCase() : undefined,
      searchId,
      requestId,
      dsaId: dsaId || undefined,
      operation,
      stage: stage || 'OTHER',
      payload: trimmed.value,
      byteLength: trimmed.byteLength,
      truncated: trimmed.truncated,
    });
    return doc._id;
  } catch (err) {
    console.error('SupplierRawPayload write failed:', err.message);
    return null;
  }
}

function stageToDirection(stage) {
  if (
    stage === 'SUPPLIER_REQUEST' ||
    stage === 'SUPPLIER_RESPONSE' ||
    stage === 'NORMALIZED_RESPONSE'
  ) {
    return 'SUPPLIER';
  }
  return 'INBOUND';
}

/**
 * Write one lifecycle stage record. Never throws to callers.
 */
async function writeLifecycleLog(entry) {
  try {
    const stage = entry.stage || 'INBOUND_REQUEST';
    const direction = entry.direction || stageToDirection(stage);
    let payloadRef = entry.payloadRef || undefined;
    let request = entry.request;
    let supplierRequest = entry.supplierRequest;
    let result = entry.result;

    const preferRaw =
      entry.storeRaw === true ||
      stage === 'SUPPLIER_REQUEST' ||
      stage === 'SUPPLIER_RESPONSE';

    if (preferRaw && entry.rawPayload != null) {
      payloadRef = await storeRawPayload({
        supplierCode: entry.supplierCode,
        searchId: entry.searchId,
        requestId: entry.requestId,
        dsaId: entry.dsaId,
        operation: entry.operation,
        stage:
          stage === 'SUPPLIER_REQUEST' || stage === 'SUPPLIER_RESPONSE'
            ? stage
            : 'OTHER',
        payload: entry.rawPayload,
      });
      // Keep a tiny inline marker; full body via payloadRef.
      if (stage === 'SUPPLIER_REQUEST') {
        supplierRequest = { payloadRef: String(payloadRef || ''), stored: true };
        request = trimPayload(entry.request, 4_000).value;
      } else if (stage === 'SUPPLIER_RESPONSE') {
        result = { payloadRef: String(payloadRef || ''), stored: true };
        request = trimPayload(entry.request, 4_000).value;
      }
    } else {
      if (request !== undefined) request = trimPayload(request).value;
      if (supplierRequest !== undefined) {
        supplierRequest = trimPayload(supplierRequest).value;
      }
      if (result !== undefined) result = trimPayload(result).value;
    }

    await ServiceLog.create({
      requestId: entry.requestId || null,
      dsaId: entry.dsaId || undefined,
      userId: entry.userId || undefined,
      direction,
      stage,
      service: entry.service,
      operation: entry.operation,
      supplierCode: entry.supplierCode
        ? String(entry.supplierCode).toUpperCase()
        : undefined,
      supplierId: entry.supplierId || undefined,
      searchId: entry.searchId,
      status: entry.status,
      httpStatus: entry.httpStatus,
      durationMs: entry.durationMs,
      request,
      supplierRequest,
      result,
      payloadRef: payloadRef || undefined,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage
        ? String(entry.errorMessage).slice(0, 2000)
        : undefined,
    });
  } catch (err) {
    console.error('Lifecycle log write failed:', err.message);
  }
}

module.exports = {
  writeLifecycleLog,
  storeRawPayload,
  trimPayload,
  MAX_INLINE_CHARS,
  MAX_RAW_CHARS,
};
