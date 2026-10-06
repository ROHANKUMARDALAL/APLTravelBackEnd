'use strict';

/**
 * Legacy shim — Flight search now uses the Phase 12 pricing engine.
 * Kept so old imports do not break; prefer calculatePrice().
 */
const {
  createPricingContext,
  calculatePrice,
} = require('../../pricing/services/pricing-engine.service');

function applyMarkup(supplierPrice, pricingContext = null) {
  const priced = calculatePrice({
    supplierPrice,
    context: pricingContext || {
      rules: [],
      at: new Date(),
      pricingVersion: '12.0',
    },
  });
  return {
    supplier: priced.supplierPrice,
    customer: priced.customerPrice,
    commercialSnapshot: priced.commercialSnapshot,
  };
}

module.exports = { applyMarkup, createPricingContext, calculatePrice };
