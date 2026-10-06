'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');

const router = express.Router();

/**
 * Liveness probe — process is up and can serve HTTP.
 * Does NOT prove Mongo or bootstrap readiness.
 * GET /health
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    return sendSuccess(res, {
      service: 'apl-travel-backend',
      alive: true,
      probe: 'liveness',
      timestamp: new Date().toISOString(),
    });
  }),
);

module.exports = router;
