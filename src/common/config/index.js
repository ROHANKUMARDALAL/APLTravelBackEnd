'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPPLIER_CODES = ['TBO', 'TRIPJACK', 'KAFILA'];

function asNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`Expected a number, got: ${String(value)}`);
  }
  return n;
}

function asEnum(value, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (allowed.includes(value)) return value;
  throw new Error(`Invalid value "${value}". Allowed: ${allowed.join(', ')}`);
}

function loadConfig() {
  const nodeEnv = asEnum(
    process.env.NODE_ENV,
    ['development', 'test', 'production'],
    'development',
  );

  const mongodbUri = String(process.env.MONGODB_URI || '').trim();
  if (!mongodbUri) {
    throw new Error(
      'MONGODB_URI is required. Copy .env.example to .env and set a MongoDB connection string.',
    );
  }
  if (!mongodbUri.startsWith('mongodb://') && !mongodbUri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must be a MongoDB connection string.');
  }

  const markup = asNumber(process.env.DEFAULT_MARKUP_PERCENT, 0);
  if (markup < 0 || markup > 100) {
    throw new Error('DEFAULT_MARKUP_PERCENT must be between 0 and 100.');
  }

  const corsOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const mockSupplierFailures = String(process.env.MOCK_SUPPLIER_FAILURES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SUPPLIER_CODES.includes(s));

  const { parseDevHostMap, normalizeHost } = require('../../public-site/utils/host');
  const publicTenantBaseDomain = normalizeHost(
    process.env.PUBLIC_TENANT_BASE_DOMAIN || '',
  );
  const publicDevHostMap =
    nodeEnv === 'production'
      ? new Map()
      : parseDevHostMap(process.env.PUBLIC_DEV_HOST_MAP || '');

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: asNumber(process.env.PORT, 3000),
    apiPrefix: String(process.env.API_PREFIX || 'api/v1').replace(/^\/+|\/+$/g, ''),
    mongodbUri,
    corsOrigins,
    throttleWindowMs: asNumber(process.env.THROTTLE_WINDOW_MS, 60_000),
    throttleLimit: asNumber(process.env.THROTTLE_LIMIT, 120),
    defaultMarkupPercent: markup,
    mockSupplierFailures,
    /** e.g. example.com → tenant resolves as {subdomain}.example.com */
    publicTenantBaseDomain,
    /** Dev-only host→DSA code map; always empty in production. */
    publicDevHostMap,
    /** Default HTTP timeout for real supplier calls (Phase 11A). */
    supplierHttpTimeoutMs: asNumber(process.env.SUPPLIER_HTTP_TIMEOUT_MS, 15_000),
    /**
     * Legacy per-code env placeholders (Phase 11 TEST). Prefer
     * SUPPLIER_{CODE}_{ENV}_* via credential-resolver.
     * Values must never be returned by admin APIs or written to logs.
     */
    suppliers: {
      tbo: {
        apiUrl: process.env.TBO_API_URL || '',
        username: process.env.TBO_USERNAME || '',
        password: process.env.TBO_PASSWORD || '',
      },
      tripjack: {
        apiUrl: process.env.TRIPJACK_API_URL || '',
        username: process.env.TRIPJACK_USERNAME || '',
        password: process.env.TRIPJACK_PASSWORD || '',
      },
      kafila: {
        apiUrl: process.env.KAFILA_API_URL || '',
        username: process.env.KAFILA_USERNAME || '',
        password: process.env.KAFILA_PASSWORD || '',
      },
    },
  };
}

const config = loadConfig();

module.exports = { config, SUPPLIER_CODES };
