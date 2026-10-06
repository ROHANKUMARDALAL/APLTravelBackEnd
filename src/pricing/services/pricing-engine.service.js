'use strict';

const PricingRule = require('../models/PricingRule');
const { toMinor, toMajor, percentOfMinor } = require('../money');
const { config } = require('../../common/config');
const { RULE_KINDS } = require('@apl/shared-domain');

const PRICING_VERSION = '12.0';

/**
 * Specificity score (higher = more specific).
 * Precedence within a kind:
 *   DSA+service+supplier > DSA+service > DSA global
 *   Platform+service+supplier > Platform+service > Platform global
 * DSA-scoped kinds only consider DSA rules (except ceilings which are PLATFORM).
 */
function specificityScore(rule, { dsaId, serviceCode, supplierCode }) {
  let score = 0;
  const svc = serviceCode ? String(serviceCode).toLowerCase() : null;
  const sup = supplierCode ? String(supplierCode).toUpperCase() : null;
  const dsa = dsaId ? String(dsaId) : null;

  if (rule.serviceCode) {
    if (!svc || rule.serviceCode !== svc) return -1;
    score += 10;
  }
  if (rule.supplierCode) {
    if (!sup || rule.supplierCode !== sup) return -1;
    score += 5;
  }
  if (rule.ownerScope === 'DSA') {
    if (!dsa || String(rule.dsaId) !== dsa) return -1;
    score += 20;
  } else if (rule.dsaId) {
    return -1;
  }
  score += Number(rule.priority || 0) / 10_000;
  return score;
}

function isEffective(rule, at) {
  if (rule.status !== 'ACTIVE') return false;
  const t = at.getTime();
  if (rule.effectiveFrom && new Date(rule.effectiveFrom).getTime() > t) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < t) return false;
  return true;
}

function pickBestRule(rules, kind, ctx) {
  let best = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (rule.ruleKind !== kind) continue;
    if (!isEffective(rule, ctx.at)) continue;
    if (ctx.tripType && rule.tripType && rule.tripType !== ctx.tripType) continue;
    const score = specificityScore(rule, ctx);
    if (score < 0) continue;
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

function adjustmentMinor(rule, baseMinor, currency) {
  if (!rule) return { minor: 0, skipped: false, reason: null };
  if (rule.adjustmentType === 'PERCENTAGE') {
    return {
      minor: percentOfMinor(baseMinor, rule.value),
      skipped: false,
      reason: null,
    };
  }
  // FIXED
  const ruleCurrency = rule.currency
    ? String(rule.currency).toUpperCase()
    : null;
  if (!ruleCurrency || ruleCurrency !== String(currency).toUpperCase()) {
    return {
      minor: 0,
      skipped: true,
      reason: 'CURRENCY_MISMATCH',
    };
  }
  return { minor: toMinor(rule.value), skipped: false, reason: null };
}

function appliedEntry(rule, amountMajor, extra = {}) {
  if (!rule) return null;
  return {
    ruleId: String(rule._id),
    name: rule.name,
    ruleKind: rule.ruleKind,
    ownerScope: rule.ownerScope,
    adjustmentType: rule.adjustmentType,
    value: rule.value,
    currency: rule.currency || null,
    amount: amountMajor,
    ...extra,
  };
}

/**
 * Load active candidate rules once per search/request.
 */
async function createPricingContext({
  dsaId = null,
  serviceCode = null,
  tripType = null,
  at = new Date(),
} = {}) {
  const svc = serviceCode ? String(serviceCode).toLowerCase() : null;
  const filter = {
    status: 'ACTIVE',
    $and: [
      {
        $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: at } }],
      },
      {
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: at } }],
      },
      {
        $or: [{ serviceCode: null }, ...(svc ? [{ serviceCode: svc }] : [])],
      },
    ],
  };
  if (dsaId) {
    filter.$and.push({
      $or: [
        { ownerScope: 'PLATFORM' },
        { ownerScope: 'DSA', dsaId },
      ],
    });
  } else {
    filter.ownerScope = 'PLATFORM';
  }

  const rules = await PricingRule.find(filter).lean();
  return {
    dsaId: dsaId ? String(dsaId) : null,
    serviceCode: svc,
    tripType: tripType || null,
    at,
    rules,
    pricingVersion: PRICING_VERSION,
  };
}

function legacyAplFallbackRule(percent) {
  return {
    _id: 'legacy-default-markup',
    name: 'Legacy DEFAULT_MARKUP_PERCENT',
    ownerScope: 'PLATFORM',
    ruleKind: RULE_KINDS.APL_MARKUP,
    adjustmentType: 'PERCENTAGE',
    value: percent,
    currency: null,
    status: 'ACTIVE',
    priority: 1,
    serviceCode: null,
    supplierCode: null,
    dsaId: null,
  };
}

/**
 * Central commercial calculator.
 * Percentages apply to supplier base (not compounded).
 * Order: supplier → commission (snapshot only) → APL → DSA → fee → discount → final
 */
function calculatePrice({
  supplierPrice,
  supplierCode = null,
  context,
  includeInternal = true,
}) {
  const currency = String(supplierPrice?.currency || 'INR').toUpperCase();
  const supplierMajor = Number(supplierPrice?.amount);
  if (!Number.isFinite(supplierMajor) || supplierMajor < 0) {
    throw new Error('supplierPrice.amount must be a non-negative number');
  }
  const supplierMinor = toMinor(supplierMajor);
  const ctx = {
    dsaId: context?.dsaId || null,
    serviceCode: context?.serviceCode || null,
    supplierCode: supplierCode
      ? String(supplierCode).toUpperCase()
      : null,
    tripType: context?.tripType || null,
    at: context?.at || new Date(),
  };
  const rules = context?.rules || [];

  let aplRule = pickBestRule(rules, RULE_KINDS.APL_MARKUP, ctx);
  if (!aplRule && Number(config.defaultMarkupPercent) > 0) {
    aplRule = legacyAplFallbackRule(config.defaultMarkupPercent);
  }

  const ceilingRule = pickBestRule(rules, RULE_KINDS.DSA_MARKUP_CEILING, ctx);
  let dsaRule = pickBestRule(rules, RULE_KINDS.DSA_MARKUP, ctx);
  const feeRule = pickBestRule(rules, RULE_KINDS.SERVICE_FEE, ctx);
  const commissionRule = pickBestRule(
    rules,
    RULE_KINDS.SUPPLIER_COMMISSION,
    ctx,
  );
  const discountRule = pickBestRule(rules, RULE_KINDS.DISCOUNT, ctx);

  // Enforce DSA ceiling (same adjustment type only).
  let ceilingBlocked = false;
  if (dsaRule && ceilingRule) {
    if (dsaRule.adjustmentType !== ceilingRule.adjustmentType) {
      // Incompatible types → block DSA markup (safe).
      dsaRule = null;
      ceilingBlocked = true;
    } else if (Number(dsaRule.value) > Number(ceilingRule.value)) {
      dsaRule = null;
      ceilingBlocked = true;
    }
  } else if (dsaRule && !ceilingRule) {
    // No ceiling configured → DSA markup still allowed (APL can set ceiling=0 to block).
  }

  const commission = adjustmentMinor(commissionRule, supplierMinor, currency);
  const apl = adjustmentMinor(aplRule, supplierMinor, currency);
  const dsa = adjustmentMinor(dsaRule, supplierMinor, currency);
  const fee = adjustmentMinor(feeRule, supplierMinor, currency);
  const discount = adjustmentMinor(discountRule, supplierMinor, currency);

  const finalMinor = Math.max(
    0,
    supplierMinor + apl.minor + dsa.minor + fee.minor - discount.minor,
  );

  const appliedRules = [
    appliedEntry(commissionRule, toMajor(commission.minor), {
      skipped: commission.skipped,
      skipReason: commission.reason,
    }),
    appliedEntry(aplRule, toMajor(apl.minor), {
      skipped: apl.skipped,
      skipReason: apl.reason,
    }),
    appliedEntry(dsaRule, toMajor(dsa.minor), {
      skipped: dsa.skipped,
      skipReason: dsa.reason,
      ceilingBlocked,
    }),
    appliedEntry(feeRule, toMajor(fee.minor), {
      skipped: fee.skipped,
      skipReason: fee.reason,
    }),
    appliedEntry(discountRule, toMajor(discount.minor), {
      skipped: discount.skipped,
      skipReason: discount.reason,
    }),
  ].filter(Boolean);

  const snapshot = {
    pricingVersion: context?.pricingVersion || PRICING_VERSION,
    calculatedAt: (context?.at || new Date()).toISOString(),
    currency,
    supplierPrice: { amount: toMajor(supplierMinor), currency },
    supplierCommission: { amount: toMajor(commission.minor), currency },
    aplMarkup: { amount: toMajor(apl.minor), currency },
    dsaMarkup: { amount: toMajor(dsa.minor), currency },
    serviceFee: { amount: toMajor(fee.minor), currency },
    discount: { amount: toMajor(discount.minor), currency },
    finalPrice: { amount: toMajor(finalMinor), currency },
    appliedRuleIds: appliedRules.map((r) => r.ruleId),
    appliedRules: includeInternal ? appliedRules : undefined,
    ceilingRuleId: ceilingRule ? String(ceilingRule._id) : null,
    ceilingBlocked,
    serviceCode: ctx.serviceCode,
    supplierCode: ctx.supplierCode,
    dsaId: ctx.dsaId,
  };

  return {
    supplierPrice: snapshot.supplierPrice,
    customerPrice: snapshot.finalPrice,
    commercialSnapshot: snapshot,
  };
}

/** Public-safe view: final price only (no margins). */
function publicPriceView(result) {
  return {
    amount: result.customerPrice.amount,
    currency: result.customerPrice.currency,
  };
}

module.exports = {
  PRICING_VERSION,
  RULE_KINDS,
  createPricingContext,
  calculatePrice,
  publicPriceView,
  pickBestRule,
  specificityScore,
};
