'use strict';

const { AppError, ErrorCode } = require('../errors/app-error');
const { sendFailure } = require('../response/envelope');

function notFoundHandler(req, res, _next) {
  return sendFailure(res, 404, {
    code: ErrorCode.NOT_FOUND,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    details: [],
  });
}

function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || 'unknown';

  let status = 500;
  let code = ErrorCode.INTERNAL_ERROR;
  let message = 'An unexpected error occurred';
  let details = [];

  if (err instanceof AppError) {
    status = err.httpStatus;
    code = err.code;
    message = err.message;
    details = err.details;
    if (status === 402) {
      code = 'PAYMENT_FAILED';
    }
  } else if (err?.name === 'ValidationError' && err.errors) {
    status = 400;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => e.message);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'Invalid JSON body';
  } else if (err?.message) {
    message = err.message;
  }

  if (status >= 500) {
    console.error(`[${requestId}]`, err);
  } else {
    console.warn(`[${requestId}] ${code}: ${message}`);
  }

  return sendFailure(res, status, { code, message, details });
}

/** Wrap async route handlers so rejected promises hit errorHandler. */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, notFoundHandler, asyncHandler };
