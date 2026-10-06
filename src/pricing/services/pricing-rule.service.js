'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const PricingRule = require('../models/PricingRule');
const { logAdminAction } = require('../../apl-admin/services/admin-action-log');
const { RULE_KINDS, createPricingContext, calculatePrice } = require('./pricing-engine.service');

const KINDS = Object.values(RULE_KINDS);
const ADJUSTMENTS = ['PERCENTAGE', 'FIXED'];

function assertObjectId(value, field) {
  if (value == null || value === '') return null;
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`);
  }
  return value;
}

function publicRule(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    ownerScope: doc.ownerScope,
    dsaId: doc.dsaId ? String(doc.dsaId) : null,
    ruleKind: doc.ruleKind,
    serviceCode: doc.serviceCode || null,
    supplierCode: doc.supplierCode || null,
    adjustmentType: doc.adjustmentType,
    value: doc.value,
    currency: doc.currency || null,
    status: doc.status,
    priority: doc.priority,
    effectiveFrom: doc.effectiveFrom,
    effectiveTo: doc.effectiveTo,
    tripType: doc.tripType || null,
    notes: doc.notes || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function validateRuleInput(input, { partial = false } = {}) {
  const details = [];
  const out = {};

  if (!partial || input.name !== undefined) {
    out.name = String(input.name || '').trim();
    if (!out.name) details.push('name is required');
  }
  if (!partial || input.ownerScope !== undefined) {
    out.ownerScope = String(input.ownerScope || '').toUpperCase();
    if (!['PLATFORM', 'DSA'].includes(out.ownerScope)) {
      details.push('ownerScope must be PLATFORM or DSA');
    }
  }
  if (!partial || input.ruleKind !== undefined) {
    out.ruleKind = String(input.ruleKind || '').toUpperCase();
    if (!KINDS.includes(out.ruleKind)) details.push('Invalid ruleKind');
  }
  if (!partial || input.adjustmentType !== undefined) {
    out.adjustmentType = String(input.adjustmentType || '').toUpperCase();
    if (!ADJUSTMENTS.includes(out.adjustmentType)) {
      details.push('adjustmentType must be PERCENTAGE or FIXED');
    }
  }
  if (!partial || input.value !== undefined) {
    out.value = Number(input.value);
    if (!Number.isFinite(out.value) || out.value < 0) {
      details.push('value must be a non-negative number');
    }
  }
  if (!partial || input.currency !== undefined) {
    out.currency = input.currency
      ? String(input.currency).trim().toUpperCase()
      : null;
  }
  if (!partial || input.serviceCode !== undefined) {
    out.serviceCode = input.serviceCode
      ? String(input.serviceCode).trim().toLowerCase()
      : null;
  }
  if (!partial || input.supplierCode !== undefined) {
    out.supplierCode = input.supplierCode
      ? String(input.supplierCode).trim().toUpperCase()
      : null;
  }
  if (!partial || input.dsaId !== undefined) {
    out.dsaId = assertObjectId(input.dsaId, 'dsaId');
  }
  if (!partial || input.status !== undefined) {
    out.status = String(input.status || 'ACTIVE').toUpperCase();
    if (!['ACTIVE', 'INACTIVE'].includes(out.status)) {
      details.push('Invalid status');
    }
  }
  if (!partial || input.priority !== undefined) {
    out.priority = Number(input.priority ?? 100);
  }
  if (!partial || input.effectiveFrom !== undefined) {
    out.effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom)
      : null;
  }
  if (!partial || input.effectiveTo !== undefined) {
    out.effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  }
  if (!partial || input.tripType !== undefined) {
    out.tripType = input.tripType
      ? String(input.tripType).toUpperCase()
      : null;
  }
  if (!partial || input.notes !== undefined) {
    out.notes = String(input.notes || '').slice(0, 1000);
  }

  if (details.length) {
    throw AppError.validation('Invalid pricing rule', details);
  }
  return out;
}

function assertRuleShape(doc) {
  if (doc.ownerScope === 'DSA' && !doc.dsaId) {
    throw AppError.validation('DSA rules require dsaId');
  }
  if (doc.ownerScope === 'PLATFORM' && doc.dsaId) {
    throw AppError.validation('PLATFORM rules must not set dsaId');
  }
  if (doc.ruleKind === RULE_KINDS.DSA_MARKUP && doc.ownerScope !== 'DSA') {
    throw AppError.validation('DSA_MARKUP must be ownerScope DSA');
  }
  if (
    (doc.ruleKind === RULE_KINDS.APL_MARKUP ||
      doc.ruleKind === RULE_KINDS.DSA_MARKUP_CEILING) &&
    doc.ownerScope !== 'PLATFORM'
  ) {
    throw AppError.validation(`${doc.ruleKind} must be ownerScope PLATFORM`);
  }
  if (doc.adjustmentType === 'FIXED' && !doc.currency) {
    throw AppError.validation('FIXED rules require currency');
  }
  if (doc.adjustmentType === 'PERCENTAGE' && doc.value > 100) {
    throw AppError.validation('PERCENTAGE value cannot exceed 100');
  }
}

async function assertDsaMarkupWithinCeiling(doc) {
  if (doc.ruleKind !== RULE_KINDS.DSA_MARKUP || doc.status !== 'ACTIVE') return;
  const context = await createPricingContext({
    dsaId: doc.dsaId,
    serviceCode: doc.serviceCode,
  });
  const { pickBestRule } = require('./pricing-engine.service');
  const bestCeiling = pickBestRule(context.rules, RULE_KINDS.DSA_MARKUP_CEILING, {
    dsaId: String(doc.dsaId),
    serviceCode: doc.serviceCode || null,
    supplierCode: doc.supplierCode || null,
    tripType: doc.tripType || null,
    at: new Date(),
  });
  if (!bestCeiling) return;
  if (bestCeiling.adjustmentType !== doc.adjustmentType) {
    throw AppError.validation(
      'DSA markup adjustmentType must match APL ceiling adjustmentType',
      [
        {
          ceilingType: bestCeiling.adjustmentType,
          markupType: doc.adjustmentType,
        },
      ],
    );
  }
  if (Number(doc.value) > Number(bestCeiling.value)) {
    throw AppError.validation('DSA markup exceeds APL ceiling', [
      {
        ceiling: bestCeiling.value,
        attempted: doc.value,
        adjustmentType: doc.adjustmentType,
      },
    ]);
  }
}

async function listRules(query = {}) {
  const filter = {};
  if (query.ownerScope) filter.ownerScope = String(query.ownerScope).toUpperCase();
  if (query.ruleKind) filter.ruleKind = String(query.ruleKind).toUpperCase();
  if (query.serviceCode) {
    filter.serviceCode = String(query.serviceCode).toLowerCase();
  }
  if (query.supplierCode) {
    filter.supplierCode = String(query.supplierCode).toUpperCase();
  }
  if (query.dsaId) filter.dsaId = assertObjectId(query.dsaId, 'dsaId');
  if (query.status) filter.status = String(query.status).toUpperCase();

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
  const [total, rows] = await Promise.all([
    PricingRule.countDocuments(filter),
    PricingRule.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  return {
    items: rows.map(publicRule),
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize) || 1),
    },
  };
}

async function getRule(id) {
  assertObjectId(id, 'id');
  const doc = await PricingRule.findById(id).lean();
  if (!doc) throw AppError.notFound('Pricing rule not found');
  return publicRule(doc);
}

async function createRule(input, actor) {
  const data = validateRuleInput(input);
  assertRuleShape(data);
  await assertDsaMarkupWithinCeiling(data);
  const doc = await PricingRule.create(data);
  await logAdminAction({
    actor,
    action: 'pricing.rule_created',
    resourceType: 'PricingRule',
    resourceId: String(doc._id),
    details: {
      name: doc.name,
      ruleKind: doc.ruleKind,
      ownerScope: doc.ownerScope,
      dsaId: doc.dsaId ? String(doc.dsaId) : null,
      value: doc.value,
      adjustmentType: doc.adjustmentType,
    },
  });
  return publicRule(doc);
}

async function updateRule(id, input, actor) {
  assertObjectId(id, 'id');
  const doc = await PricingRule.findById(id);
  if (!doc) throw AppError.notFound('Pricing rule not found');
  const patch = validateRuleInput(input, { partial: true });
  Object.assign(doc, patch);
  assertRuleShape(doc);
  await assertDsaMarkupWithinCeiling(doc);
  await doc.save();
  await logAdminAction({
    actor,
    action: 'pricing.rule_updated',
    resourceType: 'PricingRule',
    resourceId: String(doc._id),
    details: {
      name: doc.name,
      ruleKind: doc.ruleKind,
      status: doc.status,
      value: doc.value,
      adjustmentType: doc.adjustmentType,
    },
  });
  return publicRule(doc);
}

async function previewPrice(input) {
  const amount = Number(input.supplierAmount);
  const currency = String(input.currency || 'INR').toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) {
    throw AppError.validation('supplierAmount must be a non-negative number');
  }
  const context = await createPricingContext({
    dsaId: input.dsaId || null,
    serviceCode: input.serviceCode || null,
    tripType: input.tripType || null,
  });
  return calculatePrice({
    supplierPrice: { amount, currency },
    supplierCode: input.supplierCode || null,
    context,
    includeInternal: true,
  }).commercialSnapshot;
}

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  previewPrice,
  publicRule,
  assertDsaMarkupWithinCeiling,
};
