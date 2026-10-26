'use strict';

class DomainError extends Error {
  constructor(message, httpStatus = 400, details = []) {
    super(message);
    this.name = 'DomainError';
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

module.exports = { DomainError };
