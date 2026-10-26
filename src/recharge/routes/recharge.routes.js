'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { requireLogin, optionalLogin } = require('../../common/middleware/require-login');
const {
  requireTransactionTenant,
  requireOfferedService,
} = require('../../tenant/middleware/require-transaction-tenant');
const {
  catalogue,
  operatorsFor,
  plansFor,
  billFor,
  validateRecharge,
  payRecharge,
  listRecharges,
} = require('../services/recharge.service');

const router = express.Router();

router.use(requireTransactionTenant, requireOfferedService('recharge'));

router.get(
  '/meta',
  asyncHandler(async (req, res) => {
    req.businessOperation = 'CATALOGUE';
    return sendSuccess(res, catalogue());
  }),
);

router.get(
  '/operators',
  asyncHandler(async (req, res) => {
    req.businessOperation = 'CATALOGUE';
    const country = String(req.query.country || '').toUpperCase();
    return sendSuccess(res, { country, operators: operatorsFor(country), test: true });
  }),
);

router.post(
  '/plans',
  asyncHandler(async (req, res) => {
    req.businessOperation = 'PLANS';
    return sendSuccess(res, plansFor(req.body?.country, req.body?.operator, req.body?.lineType));
  }),
);

router.post(
  '/bill',
  asyncHandler(async (req, res) => {
    req.businessOperation = 'BILL';
    return sendSuccess(res, billFor(req.body || {}));
  }),
);

router.post(
  '/validate',
  optionalLogin,
  asyncHandler(async (req, res) => {
    const result = await validateRecharge(req.body || {}, {
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
    });
    req.businessOperation = 'VALIDATE';
    req.journeyId = result.journeyId;
    return sendSuccess(res, result);
  }),
);

router.post(
  '/pay',
  requireLogin,
  asyncHandler(async (req, res) => {
    const result = await payRecharge(req.body || {}, {
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
    });
    req.businessOperation = 'RECHARGE';
    req.journeyId = result.journeyId;
    return sendSuccess(res, result);
  }),
);

router.get(
  '/history',
  requireLogin,
  asyncHandler(async (req, res) => {
    req.businessOperation = 'HISTORY';
    return sendSuccess(res, await listRecharges({
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
    }));
  }),
);

module.exports = router;
