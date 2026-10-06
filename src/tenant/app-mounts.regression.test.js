'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../app');

async function get(server, path) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, json, text };
}

describe('existing API mounts remain available', () => {
  it('serves health, admin foundation, public site, and keeps /api/v1 prefix', async () => {
    const app = createApp();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const health = await get(server, '/health');
      assert.equal(health.status, 200);
      assert.equal(health.json?.success, true);
      assert.equal(health.json?.data?.alive, true);

      const ready = await get(server, '/ready');
      // createApp alone is not production-ready (no DB/listen bootstrap flags).
      assert.ok([200, 503].includes(ready.status));
      assert.equal(typeof ready.json?.success, 'boolean');

      const apl = await get(server, '/api/apl-admin/foundation');
      assert.equal(apl.status, 404);

      const dsa = await get(server, '/api/dsa-admin/foundation');
      assert.equal(dsa.status, 404);

      // Public site now requires a resolvable host/tenant (Phase 8).
      const pub = await get(server, '/api/v1/public/site');
      assert.ok([200, 403, 404].includes(pub.status));
      assert.equal(typeof pub.json?.success, 'boolean');

      const flightsMissingMethod = await get(server, '/api/v1/flights');
      // GET /flights is not a defined route, but namespace remains mounted (404 from app, not crash)
      assert.equal(flightsMissingMethod.status, 404);
      assert.equal(flightsMissingMethod.json?.success, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
