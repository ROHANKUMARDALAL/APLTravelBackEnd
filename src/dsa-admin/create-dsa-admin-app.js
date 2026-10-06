'use strict';

/**
 * Phase 15E — DSA-only Express app factory for dual-run / in-process tests.
 * Prefer the sibling DSAAdminBackEnd process on :3004 for real DSAAdmin FE traffic.
 * Legacy `/api/dsa-admin` on the B2C monolith remains ACTIVE until Phase 15G.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { config } = require('../common/config');
const { requestIdMiddleware } = require('../common/middleware/request-id');
const {
  errorHandler,
  notFoundHandler,
} = require('../common/middleware/error-handler');
const { UPLOAD_ROOT } = require('../common/media/storage');
const healthRoutes = require('../health/routes/health.routes');
const readyRoutes = require('../health/routes/ready.routes');
const dsaAdminRoutes = require('./routes');
const { sendSuccess } = require('../common/response/envelope');

function createDsaAdminApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', healthRoutes);
  app.use('/ready', readyRoutes);
  app.get('/', (_req, res) =>
    sendSuccess(res, {
      service: 'dsa-admin-app-factory',
      status: 'up',
      namespace: '/api/dsa-admin',
      note: 'Prefer DSAAdminBackEnd :3004',
    }),
  );
  app.use(
    '/media',
    express.static(UPLOAD_ROOT, {
      fallthrough: false,
      maxAge: '7d',
      index: false,
    }),
  );
  app.use('/api/dsa-admin', dsaAdminRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createDsaAdminApp };
