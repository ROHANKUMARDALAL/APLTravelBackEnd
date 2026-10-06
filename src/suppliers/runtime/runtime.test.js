'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  resolveSupplierCredentials,
  credentialMetaPublic,
  supplierHttpRequest,
  sanitizeHeadersForLog,
  SupplierErrorCode,
  SupplierRuntimeError,
  toFailedOutcome,
} = require('./index');
const { redact } = require('../../common/utils/redact');

describe('Phase 11A credential resolver', () => {
  const prev = {};

  before(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SUPPLIER_P11A_') || key.startsWith('P11A_')) {
        prev[key] = process.env[key];
      }
    }
  });

  after(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SUPPLIER_P11A_')) delete process.env[key];
    }
    Object.assign(process.env, prev);
  });

  it('9) reports missing credentials without inventing values', () => {
    delete process.env.SUPPLIER_P11A_TEST_BASE_URL;
    delete process.env.SUPPLIER_P11A_TEST_USERNAME;
    delete process.env.SUPPLIER_P11A_TEST_PASSWORD;
    const resolved = resolveSupplierCredentials({
      credentialRef: 'SUPPLIER_P11A',
      environment: 'TEST',
      supplierCode: 'P11A',
    });
    assert.equal(resolved.configured, false);
    assert.ok(resolved.missing.includes('baseUrl') || resolved.missing.includes('auth'));
    assert.equal(credentialMetaPublic(resolved).configured, false);
    assert.equal(credentialMetaPublic(resolved).hasPassword, false);
  });

  it('resolves TEST env vars via credentialRef and never puts secrets in meta', () => {
    process.env.SUPPLIER_P11A_TEST_BASE_URL = 'https://sandbox.example.test';
    process.env.SUPPLIER_P11A_TEST_USERNAME = 'user-a';
    process.env.SUPPLIER_P11A_TEST_PASSWORD = 'secret-pass';
    const resolved = resolveSupplierCredentials({
      credentialRef: 'SUPPLIER_P11A',
      environment: 'TEST',
      supplierCode: 'P11A',
    });
    assert.equal(resolved.configured, true);
    assert.equal(resolved.secrets.baseUrl, 'https://sandbox.example.test');
    assert.equal(resolved.secrets.password, 'secret-pass');
    assert.equal(resolved.meta.hasPassword, true);
    assert.equal(resolved.meta.password, undefined);
    const redacted = redact({ credentials: resolved.secrets, password: resolved.secrets.password });
    assert.equal(redacted.credentials, '[redacted]');
    assert.equal(redacted.password, '[redacted]');
  });

  it('requireConfigured throws CREDENTIALS_MISSING', () => {
    delete process.env.SUPPLIER_P11A_TEST_BASE_URL;
    delete process.env.SUPPLIER_P11A_TEST_USERNAME;
    delete process.env.SUPPLIER_P11A_TEST_PASSWORD;
    assert.throws(
      () =>
        resolveSupplierCredentials({
          credentialRef: 'SUPPLIER_P11A',
          environment: 'TEST',
          requireConfigured: true,
        }),
      (err) =>
        err instanceof SupplierRuntimeError &&
        err.code === SupplierErrorCode.CREDENTIALS_MISSING,
    );
  });
});

describe('Phase 11A supplier HTTP client', () => {
  let server;
  let port;
  let lastAuth;

  before(async () => {
    server = http.createServer((req, res) => {
      lastAuth = req.headers.authorization || '';
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token: 'should-redact-in-log-meta' }));
        return;
      }
      if (req.url === '/unauthorized') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'bad auth' }));
        return;
      }
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }, 500);
        return;
      }
      if (req.url === '/bad-json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{not-json');
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'boom' }));
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('success JSON + redacts authorization in meta', async () => {
    const result = await supplierHttpRequest({
      baseUrl: `http://127.0.0.1:${port}`,
      path: '/ok',
      method: 'POST',
      headers: { Authorization: 'Bearer super-secret' },
      body: { q: 1, password: 'x' },
      supplierCode: 'P11A',
      requestId: 'req-1',
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.ok, true);
    assert.equal(lastAuth, 'Bearer super-secret');
    assert.equal(result.meta.requestHeaders.Authorization, '[redacted]');
    assert.equal(result.meta.requestBody.password, '[redacted]');
    assert.equal(result.meta.responseBody.token, '[redacted]');
  });

  it('7) maps HTTP 401 to AUTH_FAILED', async () => {
    await assert.rejects(
      () =>
        supplierHttpRequest({
          baseUrl: `http://127.0.0.1:${port}`,
          path: '/unauthorized',
        }),
      (err) =>
        err instanceof SupplierRuntimeError &&
        err.code === SupplierErrorCode.AUTH_FAILED,
    );
  });

  it('7) maps HTTP 500 to HTTP error', async () => {
    await assert.rejects(
      () =>
        supplierHttpRequest({
          baseUrl: `http://127.0.0.1:${port}`,
          path: '/fail',
        }),
      (err) =>
        err instanceof SupplierRuntimeError &&
        err.code === SupplierErrorCode.HTTP,
    );
  });

  it('7) maps timeout', async () => {
    await assert.rejects(
      () =>
        supplierHttpRequest({
          baseUrl: `http://127.0.0.1:${port}`,
          path: '/slow',
          timeoutMs: 50,
        }),
      (err) =>
        err instanceof SupplierRuntimeError &&
        err.code === SupplierErrorCode.TIMEOUT,
    );
  });

  it('8) maps malformed JSON', async () => {
    await assert.rejects(
      () =>
        supplierHttpRequest({
          baseUrl: `http://127.0.0.1:${port}`,
          path: '/bad-json',
        }),
      (err) =>
        err instanceof SupplierRuntimeError &&
        err.code === SupplierErrorCode.MALFORMED,
    );
  });

  it('sanitizeHeadersForLog never echoes secrets', () => {
    const safe = sanitizeHeadersForLog({
      Authorization: 'Bearer x',
      'X-Api-Key': 'abc',
      Accept: 'application/json',
    });
    assert.equal(safe.Authorization, '[redacted]');
    assert.equal(safe['X-Api-Key'], '[redacted]');
    assert.equal(safe.Accept, 'application/json');
  });

  it('toFailedOutcome preserves classification', () => {
    const out = toFailedOutcome(
      new SupplierRuntimeError(SupplierErrorCode.TIMEOUT, 'timed out', {
        durationMs: 12,
      }),
      12,
    );
    assert.equal(out.status, 'FAILED');
    assert.equal(out.errorCode, SupplierErrorCode.TIMEOUT);
  });
});
