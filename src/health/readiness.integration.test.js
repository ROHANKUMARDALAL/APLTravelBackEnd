'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  classifyFetchResult,
  waitForBackendReady,
} = require('../../scripts/lib/wait-for-ready');
const {
  markDatabaseConnected,
  markInitComplete,
  markHttpListening,
  getReadinessSnapshot,
  isApplicationReady,
} = require('../common/readiness/state');
const { createApp } = require('../app');
const {
  connectDatabase,
  disconnectDatabase,
  isDatabaseHealthy,
} = require('../common/database/connection');

require('dotenv').config();

async function request(server, method, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-APL-Public-Host': 'localhost:3001',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

describe('Phase 15 readiness classification', () => {
  it('classifies connection refused as UNAVAILABLE', () => {
    const out = classifyFetchResult({
      status: null,
      body: null,
      networkError: Object.assign(new Error('fetch failed'), {
        code: 'ECONNREFUSED',
      }),
    });
    assert.equal(out.kind, 'UNAVAILABLE');
  });

  it('classifies 503 as NOT_READY', () => {
    const out = classifyFetchResult({
      status: 503,
      body: { success: false },
      networkError: null,
    });
    assert.equal(out.kind, 'NOT_READY');
  });

  it('classifies 404 as ROUTE_NOT_FOUND (not retried as ready)', () => {
    const out = classifyFetchResult({
      status: 404,
      body: { success: false },
      networkError: null,
    });
    assert.equal(out.kind, 'ROUTE_NOT_FOUND');
  });

  it('tracks bootstrap flags separately from process liveness', () => {
    markDatabaseConnected(false);
    markInitComplete(false);
    markHttpListening(false);
    assert.equal(isApplicationReady(), false);
    assert.equal(getReadinessSnapshot().reason, 'STARTING');

    markInitComplete(true);
    markHttpListening(true);
    assert.equal(getReadinessSnapshot().reason, 'DEPENDENCY_UNAVAILABLE');

    markDatabaseConnected(true);
    assert.equal(isApplicationReady(), true);
    assert.equal(getReadinessSnapshot().reason, 'READY');
  });
});

describe('Phase 15 readiness HTTP probes', () => {
  let server;
  let baseUrl;

  before(async () => {
    await connectDatabase();
    markDatabaseConnected(false);
    markInitComplete(false);
    markHttpListening(false);

    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    markHttpListening(false);
    await disconnectDatabase();
  });

  it('GET /health is alive while readiness is still pending', async () => {
    markDatabaseConnected(false);
    markInitComplete(false);
    markHttpListening(false);

    const health = await request(server, 'GET', '/health');
    assert.equal(health.status, 200);
    assert.equal(health.json?.success, true);
    assert.equal(health.json?.data?.alive, true);
    assert.equal(health.json?.data?.probe, 'liveness');

    const ready = await request(server, 'GET', '/ready');
    assert.equal(ready.status, 503);
    assert.equal(ready.json?.success, false);
    assert.ok(
      ['NOT_READY', 'DEPENDENCY_UNAVAILABLE', 'STARTING'].includes(
        ready.json?.data?.reason,
      ),
    );
  });

  it('waitForBackendReady stays pending then succeeds after bootstrap', async () => {
    markDatabaseConnected(false);
    markInitComplete(false);
    markHttpListening(false);

    const pending = await waitForBackendReady(baseUrl, {
      timeoutMs: 800,
      initialDelayMs: 50,
      maxDelayMs: 100,
    });
    assert.equal(pending.ok, false);
    assert.ok(['TIMEOUT', 'NOT_READY'].includes(pending.kind));

    const dbOk = await isDatabaseHealthy();
    assert.equal(dbOk, true);
    markDatabaseConnected(true);
    markInitComplete(true);
    markHttpListening(true);

    const ready = await waitForBackendReady(baseUrl, {
      timeoutMs: 5000,
      initialDelayMs: 50,
      maxDelayMs: 200,
    });
    assert.equal(ready.ok, true);
    assert.equal(ready.kind, 'READY');
    assert.equal(ready.status, 200);
  });

  it('after ready: Flight/Hotel/Bus/Transfer search return success (not false 404)', async () => {
    markDatabaseConnected(true);
    markInitComplete(true);
    markHttpListening(true);

    const ready = await request(server, 'GET', '/ready');
    assert.equal(ready.status, 200, 'backend must be ready before smoke searches');

    const date = '2099-10-01';
    const searches = [
      {
        label: 'Flight',
        path: '/api/v1/flights/search',
        body: {
          tripType: 'ONEWAY',
          originCityCode: 'DEL',
          destinationCityCode: 'BOM',
          departDate: date,
          adults: 1,
          children: 0,
          infants: 0,
          currency: 'INR',
        },
      },
      {
        label: 'Hotel',
        path: '/api/v1/hotels/search',
        body: {
          cityCode: '130443',
          checkIn: date,
          checkOut: '2099-10-02',
          rooms: 1,
          adults: 2,
          children: 0,
          currency: 'INR',
        },
      },
      {
        label: 'Bus',
        path: '/api/v1/buses/search',
        body: {
          from: 'New York',
          to: 'Boston',
          travelDate: date,
          adults: 1,
        },
      },
      {
        label: 'Transfer',
        path: '/api/v1/transfers/search',
        body: {
          pickup: {
            name: 'Delhi Airport (DEL)',
            kind: 'AIRPORT',
            code: 'DEL',
          },
          dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
          pickupDate: date,
          pickupTime: '14:30',
          passengers: 2,
        },
      },
    ];

    for (const item of searches) {
      const res = await request(server, 'POST', item.path, item.body);
      assert.notEqual(
        res.status,
        404,
        `${item.label} must not be a route 404 after ready`,
      );
      assert.notEqual(res.status, 503, `${item.label} must not be not-ready`);
      assert.equal(res.status, 200, `${item.label} status`);
      assert.equal(res.json?.success, true, `${item.label} success`);
    }
  });
});
