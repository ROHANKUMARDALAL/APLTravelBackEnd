'use strict';

const SupplierEnvironment = Object.freeze({
  TEST: 'TEST',
  LIVE: 'LIVE',
});

const RoutingStrategy = Object.freeze({
  PARALLEL: 'PARALLEL',
  PRIORITY: 'PRIORITY',
  FALLBACK: 'FALLBACK',
});

module.exports = {
  SupplierEnvironment,
  RoutingStrategy,
};
