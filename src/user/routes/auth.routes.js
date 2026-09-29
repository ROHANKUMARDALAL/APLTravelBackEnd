'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireLogin } = require('../../common/middleware/require-login');
const { sendSuccess } = require('../../common/response/envelope');
const { signup, login, toPublicUser } = require('../services/auth.service');
const { createCaptcha, verifyCaptcha } = require('../services/captcha.service');
const { validateSignupBody, validateLoginBody } = require('../validators/auth.validation');

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
    return sendSuccess(res, await signup(dto));
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    verifyCaptcha(req.body?.captchaId, req.body?.captchaAnswer);
    const dto = validateLoginBody(req.body);
    return sendSuccess(res, await login(dto));
  }),
);

router.get(
  '/me',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, { user: toPublicUser(req.user) });
  }),
);

module.exports = router;
