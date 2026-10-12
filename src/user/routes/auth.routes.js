'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireLogin } = require('../../common/middleware/require-login');
const { sendSuccess } = require('../../common/response/envelope');
const { signup, login, toPublicUser } = require('../services/auth.service');
const { resolvePublicTenant } = require('../../public-site/services/resolve-tenant.service');
const {
  assertCustomerCanUseDsa,
  ensureMembership,
} = require('../../customer/services/membership.service');
const { createCaptcha, verifyCaptcha } = require('../services/captcha.service');
const { validateSignupBody, validateLoginBody } = require('../validators/auth.validation');

async function joinResolvedTenant(req, userId, { create = false } = {}) {
  try {
    const { dsa } = await resolvePublicTenant(req);
    if (create) await ensureMembership({ userId, dsaId: dsa._id });
    await assertCustomerCanUseDsa({ userId, dsaId: dsa._id });
  } catch (err) {
    const status = err.httpStatus || err.statusCode || err.status;
    if (status === 403) throw err;
  }
}

const router = express.Router();

router.get(
  '/captcha',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, createCaptcha());
  }),
);

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    verifyCaptcha(req.body?.captchaId, req.body?.captchaAnswer);
    const dto = validateSignupBody(req.body);
    const result = await signup(dto);
    await joinResolvedTenant(req, result.user.userId, { create: true });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    verifyCaptcha(req.body?.captchaId, req.body?.captchaAnswer);
    const dto = validateLoginBody(req.body);
    const result = await login(dto);
    await joinResolvedTenant(req, result.user.userId);
    return sendSuccess(res, result);
  }),
);

router.get(
  '/me',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, {
      user: {
        ...toPublicUser(req.user),
        referralCode: req.customerMembership?.referralCode || '',
      },
    });
  }),
);

module.exports = router;
