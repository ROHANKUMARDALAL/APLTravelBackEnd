'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { config } = require('./common/config');
const { requestIdMiddleware } = require('./common/middleware/request-id');
const { serviceLogMiddleware } = require('./common/middleware/service-log');
const {
  errorHandler,
  notFoundHandler,
} = require('./common/middleware/error-handler');
const { UPLOAD_ROOT } = require('./common/media/storage');
const healthRoutes = require('./health/routes/health.routes');
const readyRoutes = require('./health/routes/ready.routes');
const suppliersRoutes = require('./suppliers/routes/suppliers.routes');
const hotelsRoutes = require('./hotel/routes/hotels.routes');
const flightsRoutes = require('./flight/routes/flights.routes');
const busesRoutes = require('./bus/routes/buses.routes');
const transfersRoutes = require('./transfer/routes/transfers.routes');
const bookingsRoutes = require('./booking/routes/bookings.routes');
const authRoutes = require('./user/routes/auth.routes');
const accountRoutes = require('./user/routes/account.routes');
const travellersRoutes = require('./user/routes/travellers.routes');
const aplAdminRoutes = require('./apl-admin/routes');
const dsaAdminRoutes = require('./dsa-admin/routes');
const publicSiteRoutes = require('./public-site/routes/site.routes');
const { sendSuccess } = require('./common/response/envelope');

/**
 * @param {{ includeAdminNamespaces?: boolean }} [options]
 * Production B2C (Phase 15G) does NOT mount /api/apl-admin or /api/dsa-admin.
 * Integration tests that still exercise the former combined process may pass
 * includeAdminNamespaces: true.
 */
function createApp(options = {}) {
  const includeAdminNamespaces = options.includeAdminNamespaces === true;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(
    morgan(':method :url :status :res[content-length] - :response-time ms'),
  );
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Probes must stay outside rate limiting and heavy request logging.
  app.use('/health', healthRoutes);
  app.use('/ready', readyRoutes);

  app.use(serviceLogMiddleware);
  app.use(
    rateLimit({
      windowMs: config.throttleWindowMs,
      max: config.throttleLimit,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        const path = req.path || '';
        return path === '/health' || path === '/ready';
      },
      message: {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          details: [],
        },
      },
    }),
  );

  app.get('/', (req, res) => {
    const acceptsHtml = String(req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      res.status(200).type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>APL Travel API</title>
</head>
<body style="font-family: Georgia, serif; background: #f4f8fb; color: #0c1b24; padding: 3rem;">
  <h1>APL Travel API is running</h1>
  <p>This address is the booking service. Open the website at <a href="http://localhost:3001">http://localhost:3001</a>.</p>
</body>
</html>`);
      return;
    }
    return sendSuccess(res, { service: 'apl-travel-backend', status: 'up' });
  });

  app.use(`/${config.apiPrefix}/suppliers`, suppliersRoutes);
  app.use(`/${config.apiPrefix}/hotels`, hotelsRoutes);
  app.use(`/${config.apiPrefix}/flights`, flightsRoutes);
  app.use(`/${config.apiPrefix}/buses`, busesRoutes);
  app.use(`/${config.apiPrefix}/transfers`, transfersRoutes);
  app.use(`/${config.apiPrefix}/auth`, authRoutes);
  app.use(`/${config.apiPrefix}/account`, accountRoutes);
  app.use(`/${config.apiPrefix}/travellers`, travellersRoutes);
  app.use(`/${config.apiPrefix}/bookings`, bookingsRoutes);

  // Local/dev media files (Phase 7). Production should use object storage behind the same /media URL shape.
  app.use(
    '/media',
    express.static(UPLOAD_ROOT, {
      fallthrough: false,
      maxAge: '7d',
      index: false,
    }),
  );

  // Phase 15G: admin namespaces belong to APLAdminBackEnd :3005 and DSAAdminBackEnd :3004.
  if (includeAdminNamespaces) {
    app.use('/api/apl-admin', aplAdminRoutes);
    app.use('/api/dsa-admin', dsaAdminRoutes);
  }
  app.use(`/${config.apiPrefix}/public`, publicSiteRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
