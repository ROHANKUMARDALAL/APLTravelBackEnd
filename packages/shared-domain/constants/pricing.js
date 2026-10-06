'use strict';

const RULE_KINDS = Object.freeze({
  APL_MARKUP: 'APL_MARKUP',
  DSA_MARKUP: 'DSA_MARKUP',
  DSA_MARKUP_CEILING: 'DSA_MARKUP_CEILING',
  SERVICE_FEE: 'SERVICE_FEE',
  SUPPLIER_COMMISSION: 'SUPPLIER_COMMISSION',
  DISCOUNT: 'DISCOUNT',
});

const PricingOwnerScope = Object.freeze({
  PLATFORM: 'PLATFORM',
  DSA: 'DSA',
});

const AdjustmentType = Object.freeze({
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
});

const RuleStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

/** Fields stripped from public B2C offer payloads. */
const PUBLIC_STRIP_PRICE_FIELDS = Object.freeze([
  'commercialSnapshot',
  'supplierPrice',
  'supplierAmount',
  'aplMarkup',
  'internalMargin',
]);

module.exports = {
  RULE_KINDS,
  PricingOwnerScope,
  AdjustmentType,
  RuleStatus,
  PUBLIC_STRIP_PRICE_FIELDS,
};
