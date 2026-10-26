'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const {
  requireTransactionTenant,
  requireOfferedService,
} = require('../../tenant/middleware/require-transaction-tenant');
const { requireLogin } = require('../../common/middleware/require-login');
const {
  searchInsurance,
  getInsurancePlan,
  validateInsuranceTravellers,
  checkoutInsurance,
  bookInsurance,
} = require('../services/insurance.service');

const router = express.Router();

router.use(requireTransactionTenant, requireOfferedService('insurance'));

router.post(
  '/search',
  asyncHandler(async (req, res) => {
    req.logService = 'INSURANCE';
    req.businessOperation = 'SEARCH';
    const result = await searchInsurance(req.body, {
      requestId: req.requestId,
      userId: req.user?._id,
      dsaId: req.tenant?.dsaId,
    });
    req.searchId = result.searchId;
    req.journeyId = result.searchId;
    return sendSuccess(res, result);
  }),
);

router.post(
  '/details',
  asyncHandler(async (req, res) => {
    req.logService = 'INSURANCE';
    req.businessOperation = 'DETAILS';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId || `plan:${req.body?.planId || ''}`;
    const details = await getInsurancePlan(req.body, {
      requestId: req.requestId,
      userId: req.user?._id,
      dsaId: req.tenant?.dsaId,
    });
    req.searchId = details.searchId || req.searchId;
    req.journeyId = details.searchId || req.journeyId;
    return sendSuccess(res, details);
  }),
);

router.post(
  '/travellers',
  asyncHandler(async (req, res) => {
    req.logService = 'INSURANCE';
    req.businessOperation = 'VALIDATE';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const checked = await validateInsuranceTravellers(req.body, {
      requestId: req.requestId,
      userId: req.user?._id,
      dsaId: req.tenant?.dsaId,
    });
    return sendSuccess(res, {
      valid: true,
      travellerCount: checked.travellerCount,
      sameBeneficiary: checked.sameBeneficiary,
      ages: checked.travellers.map((person) => person.age),
      disclaimer: checked.disclaimer,
    });
  }),
);

router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    req.logService = 'INSURANCE';
    req.businessOperation = 'CHECKOUT';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const session = await checkoutInsurance(req.body, {
      tenant: req.tenant,
      requestId: req.requestId,
      userId: req.user?._id,
      dsaId: req.tenant?.dsaId,
    });
    req.searchId = session.searchId || req.searchId;
    req.journeyId = session.journeyId || session.searchId || req.journeyId;
    return sendSuccess(res, session);
  }),
);

router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    req.logService = 'INSURANCE';
    req.businessOperation = 'BOOK';
    const booked = await bookInsurance(req.body, req.user, {
      tenant: req.tenant,
      requestId: req.requestId,
    });
    req.searchId = booked.searchId || req.body?.searchId;
    req.journeyId = booked.journeyId || booked.searchId || req.body?.searchId;
    return sendSuccess(res, {
      ...booked,
      demo: true,
      policyIssued: false,
      disclaimer: 'DEMO / MOCK. This booking is not an insurance policy, certificate, or real coverage.',
    });
  }),
);

module.exports = router;
