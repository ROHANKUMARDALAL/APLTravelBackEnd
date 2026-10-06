'use strict';

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
