'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateTestDatabaseConfig,
  assertDestructiveCleanup,
  rememberApprovedDatabaseName,
} = require('./test-database-guard');

const DEV = 'mongodb://127.0.0.1:27017/apl_development';
const PROD = 'mongodb+srv://user:secret@cluster.example.net/apl_production';
const ISOLATED = 'mongodb://127.0.0.1:27018/apl_test_phase17i';

describe('test database guard', () => {
  it('blocks a missing test URI', () => {
    assert.throws(
      () => evaluateTestDatabaseConfig({ allowFlag: '1', testUri: '', developmentUri: DEV }),
      /must be a MongoDB connection string/,
    );
  });

  it('blocks the development database URI', () => {
    assert.throws(
      () => evaluateTestDatabaseConfig({
        allowFlag: '1',
        testUri: DEV,
        developmentUri: DEV,
      }),
      /apl_test_/,
    );
    assert.throws(
      () => evaluateTestDatabaseConfig({
        allowFlag: '1',
        testUri: 'mongodb://127.0.0.1:27017/apl_test_phase17i',
        developmentUri: 'mongodb://127.0.0.1:27017/apl_test_phase17i',
      }),
      /development or production database/,
    );
  });

  it('blocks a production database URI', () => {
    assert.throws(
      () => evaluateTestDatabaseConfig({ allowFlag: '1', testUri: PROD, developmentUri: DEV }),
      /localhost or 127\.0\.0\.1/,
    );
  });

  it('blocks a missing test execution flag', () => {
    assert.throws(
      () => evaluateTestDatabaseConfig({ allowFlag: '', testUri: ISOLATED, developmentUri: DEV }),
      /APL_ALLOW_TEST_DB=1/,
    );
  });

  it('allows a valid isolated test database', () => {
    const decision = evaluateTestDatabaseConfig({
      allowFlag: '1',
      testUri: ISOLATED,
      developmentUri: DEV,
    });
    assert.equal(decision.databaseName, 'apl_test_phase17i');
    assert.equal(decision.host, '127.0.0.1');
  });

  it('blocks destructive cleanup outside the isolated database', () => {
    rememberApprovedDatabaseName('apl_test_phase17i');
    assert.throws(
      () => assertDestructiveCleanup({
        collection: 'bookings',
        filter: { bookingRef: 'APL-BK-1' },
        databaseName: 'apl_development',
      }),
      /outside the isolated test database/,
    );
  });

  it('blocks an unscoped session delete and allows a scoped delete', () => {
    rememberApprovedDatabaseName('apl_test_phase17i');
    assert.throws(
      () => assertDestructiveCleanup({
        collection: 'apladminsessions',
        filter: {},
        databaseName: 'apl_test_phase17i',
      }),
      /every admin or login session/,
    );
    assert.doesNotThrow(() => assertDestructiveCleanup({
      collection: 'apladminsessions',
      filter: { userId: { $in: ['run-user'] } },
      databaseName: 'apl_test_phase17i',
    }));
    assert.doesNotThrow(() => assertDestructiveCleanup({
      operation: 'dropDatabase',
      databaseName: 'apl_test_phase17i',
    }));
  });

  it('does not include a connection string in a refusal', () => {
    try {
      evaluateTestDatabaseConfig({ allowFlag: '1', testUri: PROD, developmentUri: DEV });
      assert.fail('expected refusal');
    } catch (error) {
      assert.equal(error.message.includes('mongodb'), false);
      assert.equal(error.message.includes('secret'), false);
    }
  });
});
