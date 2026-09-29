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
const healthRoutes = require('./health/routes/health.routes');
const suppliersRoutes = require('./suppliers/routes/suppliers.routes');
const hotelsRoutes = require('./hotel/routes/hotels.routes');
const flightsRoutes = require('./flight/routes/flights.routes');
const bookingsRoutes = require('./booking/routes/bookings.routes');
const authRoutes = require('./user/routes/auth.routes');
const accountRoutes = require('./user/routes/account.routes');

function createApp() {
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
  app.use(serviceLogMiddleware);
  app.use(
    rateLimit({
      windowMs: config.throttleWindowMs,
      max: config.throttleLimit,
      standardHeaders: true,
      legacyHeaders: false,
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

  app.use('/health', healthRoutes);
  app.use(`/${config.apiPrefix}/suppliers`, suppliersRoutes);
  app.use(`/${config.apiPrefix}/hotels`, hotelsRoutes);
  app.use(`/${config.apiPrefix}/flights`, flightsRoutes);
  app.use(`/${config.apiPrefix}/auth`, authRoutes);
  app.use(`/${config.apiPrefix}/account`, accountRoutes);
  app.use(`/${config.apiPrefix}/bookings`, bookingsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
