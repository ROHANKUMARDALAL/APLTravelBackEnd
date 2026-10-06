'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const { AppError } = require('../../common/errors/app-error');
const rules = require('../../pricing/services/pricing-rule.service');
const {
  createPricingContext,
  pickBestRule,
  RULE_KINDS,
} = require('../../pricing/services/pricing-engine.service');

function actor(req) {
  return {
    id: req.admin?.id,
    email: req.admin?.email,
    type: 'DSA',
    dsaId: req.tenant?.dsaId,
  };
}

function dsaIdFrom(req) {
  const id = req.tenant?.dsaId;
  if (!id) throw AppError.forbidden('DSA tenant context required');
  return String(id);
}

async function list(req, res) {
  const dsaId = dsaIdFrom(req);
  const data = await rules.listRules({
    ...(req.query || {}),
    ownerScope: 'DSA',
    dsaId,
  });
  return sendSuccess(res, data);
}

async function ceiling(req, res) {
  const dsaId = dsaIdFrom(req);
  const serviceCode = req.query?.serviceCode || 'flight';
  const context = await createPricingContext({ dsaId, serviceCode });
  const best = pickBestRule(context.rules, RULE_KINDS.DSA_MARKUP_CEILING, {
    dsaId,
    serviceCode: String(serviceCode).toLowerCase(),
    supplierCode: req.query?.supplierCode
      ? String(req.query.supplierCode).toUpperCase()
      : null,
    tripType: null,
    at: new Date(),
  });
  return sendSuccess(res, {
    serviceCode,
    ceiling: best
      ? {
          id: String(best._id),
          name: best.name,
          adjustmentType: best.adjustmentType,
          value: best.value,
          currency: best.currency || null,
        }
      : null,
  });
}

async function upsertMarkup(req, res) {
  const dsaId = dsaIdFrom(req);
  const body = req.body || {};
  const serviceCode = body.serviceCode
    ? String(body.serviceCode).toLowerCase()
    : 'flight';

  const existing = await rules.listRules({
    ownerScope: 'DSA',
    dsaId,
    ruleKind: RULE_KINDS.DSA_MARKUP,
    serviceCode,
    status: undefined,
    pageSize: 20,
  });
  const match = existing.items.find(
    (r) =>
      (r.supplierCode || null) ===
      (body.supplierCode
        ? String(body.supplierCode).toUpperCase()
        : null),
  );

  const payload = {
    name: body.name || `DSA markup ${serviceCode}`,
    ownerScope: 'DSA',
    dsaId,
    ruleKind: RULE_KINDS.DSA_MARKUP,
    serviceCode,
    supplierCode: body.supplierCode || null,
    adjustmentType: body.adjustmentType || 'PERCENTAGE',
    value: body.value,
    currency: body.currency || null,
    status: body.status || 'ACTIVE',
    priority: body.priority || 100,
    notes: body.notes || '',
  };

  let rule;
  if (match) {
    rule = await rules.updateRule(match.id, payload, actor(req));
  } else {
    rule = await rules.createRule(payload, actor(req));
  }
  return sendSuccess(res, { rule });
}

async function preview(req, res) {
  const dsaId = dsaIdFrom(req);
  const snapshot = await rules.previewPrice({
    ...(req.body || {}),
    dsaId,
  });
  // DSA preview: hide APL internal rule details beyond totals.
  return sendSuccess(res, {
    snapshot: {
      currency: snapshot.currency,
      supplierPrice: snapshot.supplierPrice,
      aplMarkup: snapshot.aplMarkup,
      dsaMarkup: snapshot.dsaMarkup,
      serviceFee: snapshot.serviceFee,
      discount: snapshot.discount,
      finalPrice: snapshot.finalPrice,
      pricingVersion: snapshot.pricingVersion,
      calculatedAt: snapshot.calculatedAt,
    },
  });
}

module.exports = { list, ceiling, upsertMarkup, preview };
