'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireDsaAdmin } = require('../middleware/require-dsa-admin');
const { login, logout, me } = require('../controllers/auth.controller');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Try again later.',
      details: [],
    },
  },
});

router.post('/login', loginLimiter, asyncHandler(login));
router.post('/logout', requireDsaAdmin, asyncHandler(logout));
router.get('/me', requireDsaAdmin, asyncHandler(me));

module.exports = router;
