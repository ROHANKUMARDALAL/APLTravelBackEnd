'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const rules = require('../../pricing/services/pricing-rule.service');
const { AppError } = require('../../common/errors/app-error');
const { RULE_KINDS } = require('../../pricing/services/pricing-engine.service');

function actor(req) {
  return { id: req.admin?.id, email: req.admin?.email, type: 'APL' };
}

async function list(req, res) {
  return sendSuccess(res, await rules.listRules(req.query || {}));
}

async function get(req, res) {
  return sendSuccess(res, { rule: await rules.getRule(req.params.id) });
}

async function create(req, res) {
  const body = { ...(req.body || {}), ownerScope: req.body?.ownerScope || 'PLATFORM' };
  if (body.ruleKind === RULE_KINDS.DSA_MARKUP && body.ownerScope !== 'DSA') {
    throw AppError.validation('Use DSA ownerScope for DSA_MARKUP');
  }
  const rule = await rules.createRule(body, actor(req));
  return sendSuccess(res, { rule });
}

async function update(req, res) {
  const existing = await rules.getRule(req.params.id);
  if (existing.ownerScope === 'DSA' && req.body?.ownerScope === 'PLATFORM') {
    throw AppError.validation('Cannot convert DSA rule to PLATFORM via this path');
  }
  const rule = await rules.updateRule(req.params.id, req.body || {}, actor(req));
  return sendSuccess(res, { rule });
}

async function preview(req, res) {
  const snapshot = await rules.previewPrice(req.body || {});
  return sendSuccess(res, { snapshot });
}

module.exports = { list, get, create, update, preview };
