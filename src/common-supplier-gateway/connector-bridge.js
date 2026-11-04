'use strict';

const { config } = require('../common/config');

const CALLABLE = new Set(['SANDBOX_READY', 'TESTED', 'LIVE_READY']);
const BLOCKED = new Set(['PLACEHOLDER', 'DEVELOPMENT', 'DISABLED']);

function loadConnectors() {
  return require('@apltravel/supplier-connectors');
}

/**
 * MOCK and READY stay on the existing in-process adapters.
 * The connector package is used only for an explicitly callable status while the gateway flag is on.
 */
function connectorForSupplier(supplier) {
  if (!config.commonSupplierGateway.enabled) return { useConnector: false, blocked: false };
  const status = String(supplier?.integrationStatus || 'MOCK').toUpperCase();
  if (BLOCKED.has(status)) return { useConnector: false, blocked: true, status };
  if (!CALLABLE.has(status)) return { useConnector: false, blocked: false };
  const connectors = loadConnectors();
  const adapter = connectors.getAdapter(supplier.code);
  if (!adapter) return { useConnector: false, blocked: true, status };
  return {
    useConnector: true,
    blocked: false,
    adapter: {
      code: adapter.code,
      isMock: false,
      async searchFlights() {
        connectors.assertCallable(adapter, 'SEARCH');
        return { status: 'FAILED', errorCode: 'INTEGRATION_PENDING', flights: [], durationMs: 0 };
      },
      async searchHotels() {
        connectors.assertCallable(adapter, 'SEARCH');
        return { status: 'FAILED', errorCode: 'INTEGRATION_PENDING', hotels: [], durationMs: 0 };
      },
    },
  };
}

module.exports = { connectorForSupplier, loadConnectors };
