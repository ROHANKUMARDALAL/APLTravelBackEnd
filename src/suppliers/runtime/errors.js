'use strict';

/**
 * Normalized supplier runtime error classifications (Phase 11A).
 * Adapters map supplier-specific failures into these codes.
 */
const SupplierErrorCode = {
  CREDENTIALS_MISSING: 'SUPPLIER_CREDENTIALS_MISSING',
  AUTH_FAILED: 'SUPPLIER_AUTH_FAILED',
  TIMEOUT: 'SUPPLIER_TIMEOUT',
  NETWORK: 'SUPPLIER_NETWORK_ERROR',
  HTTP: 'SUPPLIER_HTTP_ERROR',
  BUSINESS: 'SUPPLIER_BUSINESS_ERROR',
  MALFORMED: 'SUPPLIER_MALFORMED_RESPONSE',
  EMPTY: 'SUPPLIER_EMPTY_RESULT',
  MAPPING: 'SUPPLIER_MAPPING_FAILURE',
  EXCEPTION: 'SUPPLIER_EXCEPTION',
};

class SupplierRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'SupplierRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function toFailedOutcome(err, durationMs = 0) {
  if (err instanceof SupplierRuntimeError) {
    return {
      status: 'FAILED',
      durationMs,
      errorCode: err.code,
      errorMessage: err.message,
      errorDetails: err.details || undefined,
    };
  }
  return {
    status: 'FAILED',
    durationMs,
    errorCode: SupplierErrorCode.EXCEPTION,
    errorMessage: err instanceof Error ? err.message : 'Unknown supplier error',
  };
}

module.exports = {
  SupplierErrorCode,
  SupplierRuntimeError,
  toFailedOutcome,
};
