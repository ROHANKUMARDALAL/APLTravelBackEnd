'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { isDatabaseHealthy } = require('../../common/database/connection');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const databaseOk = await isDatabaseHealthy();
    return sendSuccess(
      res,
      {
        service: 'apl-travel-backend',
        database: databaseOk ? 'up' : 'down',
        timestamp: new Date().toISOString(),
      },
      { status: databaseOk ? 'ok' : 'degraded' },
    );
  }),
);

module.exports = router;
