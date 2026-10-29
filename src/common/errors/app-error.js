'use strict';

const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SEARCH_FAILED: 'SEARCH_FAILED',
  SUPPLIER_ERROR: 'SUPPLIER_ERROR',
  NO_SUPPLIER_ASSIGNED: 'NO_SUPPLIER_ASSIGNED',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  INSUFFICIENT_WALLET_BALANCE: 'INSUFFICIENT_WALLET_BALANCE',
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

  static forbidden(message = 'Permission denied') {
    return new AppError(ErrorCode.FORBIDDEN, message, { httpStatus: 403 });
  }

  static noSupplier(message = 'No supplier is assigned for this service', details = []) {
    return new AppError(ErrorCode.NO_SUPPLIER_ASSIGNED, message, {
      httpStatus: 409,
      details,
    });
  }

  static internal(message, cause) {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, {
      httpStatus: 500,
      cause,
    });
  }
}

module.exports = { AppError, ErrorCode };
