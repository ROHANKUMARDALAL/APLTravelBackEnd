'use strict';

const mongoose = require('mongoose');
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
  if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
    return null;
  }
  try {
    const stage = entry.stage || 'INBOUND_REQUEST';
    const direction = entry.direction || stageToDirection(stage);
    if (entry.requestId && !entry.supplierCode && (stage === 'INBOUND_REQUEST' || stage === 'OUTBOUND_RESPONSE' || stage === 'ERROR')) {
      const priorStages = stage === 'INBOUND_REQUEST'
        ? ['INBOUND_REQUEST', 'NORMALIZED_REQUEST']
        : ['OUTBOUND_RESPONSE', 'NORMALIZED_RESPONSE', 'ERROR'];
      const prior = await ServiceLog.exists({
        requestId: entry.requestId,
        stage: { $in: priorStages },
      });
      if (prior) return null;
    }
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
          stage === 'SUPPLIER_REQUEST' || stage === 'SUPPLIER_RESPONSE' || stage === 'NORMALIZED_RESPONSE'
            ? stage
            : 'OTHER',
        payload: entry.rawPayload,
      });
      if (stage === 'SUPPLIER_REQUEST') {
        supplierRequest = { payloadRef: String(payloadRef || ''), stored: true };
        request = trimPayload(entry.request, 4_000).value;
      } else if (stage === 'SUPPLIER_RESPONSE') {
        result = { payloadRef: String(payloadRef || ''), stored: true };
        request = trimPayload(entry.request, 4_000).value;
      } else {
        const summary = entry.result && typeof entry.result === 'object' ? trimPayload(entry.result, 4_000).value : {};
        result = { ...summary, payloadRef: String(payloadRef || ''), stored: true };
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
      journeyId: entry.journeyId || undefined,
      parentJourneyId: entry.parentJourneyId || undefined,
      businessOperation: entry.businessOperation || undefined,
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

async function logPublicSearchResult({ requestId, dsaId, userId, service, searchId, payload, journeyId, businessOperation }) {
  await writeLifecycleLog({
    stage: 'NORMALIZED_RESPONSE',
    direction: 'INBOUND',
    requestId,
    journeyId,
    businessOperation,
    dsaId,
    userId,
    service,
    operation: 'publicSearchResult',
    searchId: searchId || payload?.searchId,
    status: payload?.status === 'FAILED' ? 'FAILED' : payload?.status === 'PARTIAL' ? 'PARTIAL' : 'SUCCESS',
    storeRaw: true,
    rawPayload: payload,
    result: { publicResponse: true, searchId: payload?.searchId || searchId || null },
  });
}

module.exports.logPublicSearchResult = logPublicSearchResult;
