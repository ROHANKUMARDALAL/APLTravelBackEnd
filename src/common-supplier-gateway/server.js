'use strict';

/**
 * Optional standalone listener. The travel API remains the public entrypoint.
 * Start only when COMMON_SUPPLIER_GATEWAY_ENABLED=1 and GATEWAY_INTERNAL_TOKEN is set.
 */
const express = require('express');
const { config } = require('../common/config');
const { createGatewayRouter } = require('./routes');

function createGatewayApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  if (!config.commonSupplierGateway.enabled || !config.commonSupplierGateway.internalToken) {
    app.use((_req, res) => {
      res.status(503).json({
        success: false,
        error: { message: 'Common Supplier Gateway is disabled' },
      });
    });
    return app;
  }
  app.use('/internal/v1', createGatewayRouter());
  return app;
}

if (require.main === module) {
  const app = createGatewayApp();
  app.listen(config.commonSupplierGateway.port, '127.0.0.1');
}

module.exports = { createGatewayApp };
