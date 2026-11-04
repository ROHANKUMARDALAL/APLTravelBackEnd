'use strict';

/**
 * Unknown supplier APIs are not inferred from an API key.
 * Official documentation and sandbox credentials are required before a real adapter exists.
 */
function createPlaceholderAdapter(code) {
  const supplierCode = String(code || 'UNKNOWN').toUpperCase();
  return {
    code: supplierCode,
    displayName: `${supplierCode} (integration pending)`,
    isMock: false,
    integrationStatus: 'PLACEHOLDER',
    capabilities: [],
    missing: ['official API documentation', 'sandbox credentials'],
  };
}

module.exports = { createPlaceholderAdapter };
