'use strict';

const fs = require('fs');
const path = require('path');

const TEST_DATABASE_NAME = /^apl_test_[a-z0-9_]+$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const SESSION_COLLECTIONS = new Set([
  'apladminsessions',
  'dsaadminsessions',
  'loginsessions',
]);

let approvedDatabaseName = '';

function isDatabaseTestProcess() {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.APL_ALLOW_TEST_DB === '1') return true;
  const argv = [...process.execArgv, ...process.argv].join(' ');
  return argv.includes('--test') || /\.(?:integration\.)?test\.js\b/.test(argv);
}

function databaseIdentity(uri) {
  const raw = String(uri || '').trim();
  if (!raw.startsWith('mongodb://') && !raw.startsWith('mongodb+srv://')) {
    return null;
  }
  try {
    const parsed = new URL(raw.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
    return {
      databaseName,
      host: parsed.hostname,
      remote: raw.startsWith('mongodb+srv://'),
    };
  } catch {
    return null;
  }
}

function readDotenvDatabaseUri() {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0 || trimmed.slice(0, eq).trim() !== 'MONGODB_URI') continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Pure check. Does not open a connection and does not include the URI in errors.
 */
function evaluateTestDatabaseConfig({
  allowFlag,
  testUri,
  developmentUri = '',
} = {}) {
  if (allowFlag !== '1') {
    throw new Error(
      'Refusing to open a database from a test. Set APL_ALLOW_TEST_DB=1 and APL_TEST_MONGODB_URI to a localhost database named apl_test_*.',
    );
  }
  const testIdentity = databaseIdentity(testUri);
  if (!testIdentity || !testIdentity.databaseName) {
    throw new Error('APL_TEST_MONGODB_URI must be a MongoDB connection string with a database name.');
  }
  if (testIdentity.remote || !LOOPBACK_HOSTS.has(testIdentity.host)) {
    throw new Error('Isolated test database must use localhost or 127.0.0.1. Remote and production hosts are refused.');
  }
  if (!TEST_DATABASE_NAME.test(testIdentity.databaseName)) {
    throw new Error('Isolated test database name must match apl_test_<name>. Other database names are refused.');
  }
  const developmentIdentity = databaseIdentity(developmentUri);
  const sameDatabase = developmentIdentity
    && developmentIdentity.databaseName === testIdentity.databaseName;
  const sameUri = developmentUri
    && String(developmentUri).trim() === String(testUri).trim();
  if (sameDatabase || sameUri) {
    throw new Error('Refusing to open the development or production database from a test.');
  }
  return {
    databaseName: testIdentity.databaseName,
    host: testIdentity.host,
    uri: String(testUri).trim(),
  };
}

function assertIsolatedTestDatabase() {
  const decision = evaluateTestDatabaseConfig({
    allowFlag: process.env.APL_ALLOW_TEST_DB,
    testUri: process.env.APL_TEST_MONGODB_URI,
    developmentUri: readDotenvDatabaseUri(),
  });
  approvedDatabaseName = decision.databaseName;
  return decision.uri;
}

function rememberApprovedDatabaseName(name) {
  if (!TEST_DATABASE_NAME.test(String(name || ''))) {
    throw new Error('Isolated test database name must match apl_test_<name>. Other database names are refused.');
  }
  approvedDatabaseName = String(name);
}

function isUnscopedFilter(filter) {
  if (filter == null || typeof filter !== 'object' || Array.isArray(filter)) return true;
  return Object.keys(filter).length === 0;
}

function assertDestructiveCleanup({
  collection = '',
  filter,
  databaseName = '',
  operation = 'delete',
} = {}) {
  const approved = approvedDatabaseName;
  if (!approved || databaseName !== approved || !TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error('Refusing destructive cleanup outside the isolated test database for this run.');
  }
  if (operation === 'dropDatabase') return;
  if (SESSION_COLLECTIONS.has(String(collection).toLowerCase()) && isUnscopedFilter(filter)) {
    throw new Error('Refusing to delete every admin or login session. Scope cleanup to records created by this test run.');
  }
}

function currentApprovedDatabaseName() {
  return approvedDatabaseName;
}

module.exports = {
  TEST_DATABASE_NAME,
  SESSION_COLLECTIONS,
  isDatabaseTestProcess,
  databaseIdentity,
  evaluateTestDatabaseConfig,
  assertIsolatedTestDatabase,
  assertDestructiveCleanup,
  isUnscopedFilter,
  currentApprovedDatabaseName,
  rememberApprovedDatabaseName,
};
