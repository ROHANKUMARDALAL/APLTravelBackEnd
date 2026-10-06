'use strict';

const { ErrorCode } = require('../errors/app-error');

/** Numeric APL error codes — 0 always means success. */
const NumericErrorCode = {
  SUCCESS: 0,
  [ErrorCode.VALIDATION_ERROR]: 1001,
  [ErrorCode.NOT_FOUND]: 1002,
  [ErrorCode.RATE_LIMITED]: 1003,
  [ErrorCode.INTERNAL_ERROR]: 1004,
  [ErrorCode.SEARCH_FAILED]: 1005,
  [ErrorCode.SUPPLIER_ERROR]: 1006,
  [ErrorCode.DATABASE_UNAVAILABLE]: 1007,
  [ErrorCode.UNAUTHORIZED]: 1009,
  [ErrorCode.FORBIDDEN]: 1010,
  PAYMENT_FAILED: 1008,
};

function successErrorBlock() {
  return {
    errorCode: NumericErrorCode.SUCCESS,
    ErrorMessage: 'Success',
  };
}

function failureErrorBlock(code, message, details = []) {
  const errorCode =
    typeof code === 'number'
      ? code
      : NumericErrorCode[code] ?? NumericErrorCode[ErrorCode.INTERNAL_ERROR];

  return {
    errorCode,
    ErrorMessage: message || 'An unexpected error occurred',
    code: typeof code === 'string' ? code : undefined,
    details,
  };
}

/**
 * Standard success envelope:
 * {
 *   error: { errorCode: 0, ErrorMessage: "Success" },
 *   success: true,
 *   data: ...,
 *   meta: ...
 * }
 */
function sendSuccess(res, data, meta = {}) {
  const requestId = res.req?.requestId || 'unknown';
  return res.status(200).json({
    error: successErrorBlock(),
    success: true,
    data: data ?? null,
    meta: { requestId, ...meta },
  });
}

function sendFailure(res, httpStatus, { code, message, details = [] }) {
  const requestId = res.req?.requestId || 'unknown';
  return res.status(httpStatus).json({
    error: failureErrorBlock(code, message, details),
    success: false,
    data: null,
    meta: { requestId },
  });
}

module.exports = {
  sendSuccess,
  sendFailure,
  successErrorBlock,
  failureErrorBlock,
  NumericErrorCode,
};
