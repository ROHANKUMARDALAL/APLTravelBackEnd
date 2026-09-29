'use strict';

const { config } = require('../../common/config');

function applyMarkup(supplierPrice) {
  const markupPercent = config.defaultMarkupPercent;
  const customerAmount =
    Math.round(supplierPrice.amount * (1 + markupPercent / 100) * 100) / 100;
  return {
    supplier: supplierPrice,
    customer: { amount: customerAmount, currency: supplierPrice.currency },
    markupPercent,
  };
}

module.exports = { applyMarkup };
