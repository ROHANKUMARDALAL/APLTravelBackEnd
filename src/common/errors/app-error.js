'use strict';

const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SEARCH_FAILED: 'SEARCH_FAILED',
  SUPPLIER_ERROR: 'SUPPLIER_ERROR',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
};

class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options.httpStatus || 400;
    this.details = options.details || [];
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  static validation(message, details = []) {
    return new AppError(ErrorCode.VALIDATION_ERROR, message, {
      httpStatus: 400,
      details,
    });
  }

  static notFound(message) {
    return new AppError(ErrorCode.NOT_FOUND, message, { httpStatus: 404 });
  }

  static unauthorized(message = 'Login token is required') {
    return new AppError(ErrorCode.UNAUTHORIZED, message, { httpStatus: 401 });
  }

  static internal(message, cause) {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, {
      httpStatus: 500,
      cause,
    });
  }
}

module.exports = { AppError, ErrorCode };
