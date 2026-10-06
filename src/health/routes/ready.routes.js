'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { ErrorCode } = require('../../common/errors/app-error');
const { isDatabaseHealthy } = require('../../common/database/connection');
const {
  getReadinessSnapshot,
  markDatabaseConnected,
} = require('../../common/readiness/state');

const router = express.Router();

/**
 * Readiness probe — application can accept traffic.
 * Requires Mongo connectivity + completed init + HTTP listening.
 * GET /ready
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const databaseOk = await isDatabaseHealthy();
    markDatabaseConnected(
      databaseOk,
      databaseOk ? null : 'MongoDB ping failed',
    );

    const snapshot = getReadinessSnapshot();
    const payload = {
      ...snapshot,
      probe: 'readiness',
      database: databaseOk ? 'up' : 'down',
    };

    if (!snapshot.ready) {
      const code =
        snapshot.reason === 'DEPENDENCY_UNAVAILABLE'
          ? ErrorCode.DATABASE_UNAVAILABLE
          : ErrorCode.INTERNAL_ERROR;
      // Include structured readiness body for operators/scripts even on 503.
      const requestId = res.req?.requestId || 'unknown';
      return res.status(503).json({
        error: {
          errorCode:
            code === ErrorCode.DATABASE_UNAVAILABLE ? 1007 : 1004,
          ErrorMessage:
            snapshot.reason === 'DEPENDENCY_UNAVAILABLE'
              ? 'Dependency not ready (database)'
              : 'Application not ready',
          code,
          details: snapshot.pending.map((name) => ({
            field: name,
            issue: 'pending',
          })),
        },
        success: false,
        data: payload,
        meta: { requestId, status: 'not_ready' },
      });
    }

    return sendSuccess(res, payload, { status: 'ready' });
  }),
);

module.exports = router;
