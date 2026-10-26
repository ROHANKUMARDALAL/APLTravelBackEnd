'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { executeSupplierPlan } = require('./supplier-execution.service');
const { shareOperation } = require('../../common/services/operation-dedupe');

function entry(code, priority) {
  return { supplierCode: code, priority, adapter: { code } };
}

function plan(strategy, codes) {
  return {
    strategy,
    suppliers: codes.map((code, index) => entry(code, index + 1)),
  };
}

describe('supplier execution strategies', () => {
  it('PARALLEL calls every eligible supplier and keeps mixed results', async () => {
    const called = [];
    const result = await executeSupplierPlan(plan('PARALLEL', ['A', 'B', 'C']), {
      concurrency: 3,
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        if (row.supplierCode === 'B') return { status: 'FAILED', errorCode: 'BUSINESS_FAILURE', count: 0 };
        return { status: 'SUCCESS', count: 1 };
      },
    });
    assert.deepEqual(called.sort(), ['A', 'B', 'C']);
    assert.equal(result.settled.length, 3);
    assert.equal(result.settled.filter((row) => row.outcome.status === 'SUCCESS').length, 2);
    assert.equal(result.settled.find((row) => row.adapter.code === 'B').outcome.errorCode, 'BUSINESS_FAILURE');
  });

  it('PRIORITY stops after the first usable result', async () => {
    const called = [];
    await executeSupplierPlan(plan('PRIORITY', ['A', 'B', 'C']), {
      isUsable: (outcome) => outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        return { status: 'SUCCESS', count: 2 };
      },
    });
    assert.deepEqual(called, ['A']);
  });

  it('PRIORITY continues when the first supplier fails', async () => {
    const called = [];
    await executeSupplierPlan(plan('PRIORITY', ['A', 'B', 'C']), {
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        if (row.supplierCode === 'A') return { status: 'FAILED', errorCode: 'DOWN', count: 0 };
        return { status: 'SUCCESS', count: 1 };
      },
    });
    assert.deepEqual(called, ['A', 'B']);
  });

  it('PRIORITY continues after a successful empty result', async () => {
    const called = [];
    await executeSupplierPlan(plan('PRIORITY', ['A', 'B']), {
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        return row.supplierCode === 'A'
          ? { status: 'SUCCESS', count: 0 }
          : { status: 'SUCCESS', count: 1 };
      },
    });
    assert.deepEqual(called, ['A', 'B']);
  });

  it('FALLBACK moves to the next supplier only after failure', async () => {
    const called = [];
    await executeSupplierPlan(plan('FALLBACK', ['A', 'B', 'C']), {
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        if (row.supplierCode === 'A') return { status: 'FAILED', errorCode: 'DOWN', count: 0 };
        return { status: 'SUCCESS', count: 1 };
      },
    });
    assert.deepEqual(called, ['A', 'B']);
  });

  it('FALLBACK does not call the next supplier after a successful primary', async () => {
    const called = [];
    const result = await executeSupplierPlan(plan('FALLBACK', ['A', 'B']), {
      isUsable: (outcome) => outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        return { status: 'SUCCESS', count: 1 };
      },
    });
    assert.deepEqual(called, ['A']);
    assert.equal(result.skipped[0].reason, 'STOPPED_AFTER_USABLE_RESULT');
  });

  it('FALLBACK stops on a successful empty result', async () => {
    const called = [];
    const result = await executeSupplierPlan(plan('FALLBACK', ['A', 'B']), {
      isUsable: (outcome) => outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        return { status: 'SUCCESS', count: 0 };
      },
    });
    assert.deepEqual(called, ['A']);
    assert.equal(result.skipped[0].reason, 'STOPPED_AFTER_EMPTY_SUCCESS');
  });

  it('records a supplier timeout without discarding later priority work', async () => {
    const called = [];
    const result = await executeSupplierPlan(plan('PRIORITY', ['A', 'B']), {
      timeoutMs: 30,
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        if (row.supplierCode === 'A') {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { status: 'SUCCESS', count: 1 };
        }
        return { status: 'SUCCESS', count: 1 };
      },
    });
    assert.deepEqual(called, ['A', 'B']);
    assert.equal(result.settled[0].outcome.errorCode, 'SUPPLIER_TIMEOUT');
    assert.equal(result.settled[1].outcome.status, 'SUCCESS');
  });

  it('treats HTTP 200 business failure as unusable', async () => {
    const called = [];
    await executeSupplierPlan(plan('PRIORITY', ['A', 'B']), {
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.count > 0,
      invoke: async (row) => {
        called.push(row.supplierCode);
        if (row.supplierCode === 'A') {
          return { status: 'FAILED', httpStatus: 200, errorCode: 'SOLD_OUT', count: 0 };
        }
        return { status: 'SUCCESS', count: 3 };
      },
    });
    assert.deepEqual(called, ['A', 'B']);
  });

  it('shares one in-flight operation across duplicate callers', async () => {
    let calls = 0;
    const work = () => shareOperation('ssr:test', async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true };
    });
    const [left, right] = await Promise.all([work(), work()]);
    assert.equal(calls, 1);
    assert.deepEqual(left, right);
  });
});
