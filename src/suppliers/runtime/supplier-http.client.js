'use strict';

const { config } = require('../../common/config');
const { redact } = require('../../common/utils/redact');
const {
  SupplierErrorCode,
  SupplierRuntimeError,
} = require('./errors');

/**
 * Generic supplier HTTP client (Phase 11A).
 * Not Flight-specific. Uses global fetch (Node >= 20).
 *
 * Never logs Authorization headers or credential values.
 */

function defaultTimeoutMs() {
  return Number(config.supplierHttpTimeoutMs || process.env.SUPPLIER_HTTP_TIMEOUT_MS || 15_000);
}

function sanitizeHeadersForLog(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|api[-_]?key|cookie|x-api-key|proxy-authorization/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = value;
    }
  }
  return redact(out);
}

function buildUrl(baseUrl, path = '') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  const suffix = String(path).startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} [options.path]
 * @param {string} [options.method]
 * @param {object} [options.headers]
 * @param {object|string|null} [options.body]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.supplierCode]
 * @param {string} [options.requestId]
 * @param {AbortSignal} [options.signal]
 */
async function supplierHttpRequest(options = {}) {
  const started = Date.now();
  const method = String(options.method || 'GET').toUpperCase();
  const timeoutMs = Number(options.timeoutMs || defaultTimeoutMs());
  const url = buildUrl(options.baseUrl, options.path || '');

  if (!url) {
    throw new SupplierRuntimeError(
      SupplierErrorCode.CREDENTIALS_MISSING,
      'Supplier HTTP baseUrl is required',
    );
  }

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  let body;
  if (options.body !== undefined && options.body !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof options.body === 'string') {
      body = options.body;
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const safeMeta = {
    supplierCode: options.supplierCode || undefined,
    requestId: options.requestId || undefined,
    method,
    url,
    timeoutMs,
    requestHeaders: sanitizeHeadersForLog(headers),
    requestBody: options.body != null ? redact(options.body) : undefined,
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    const responseMeta = {
      ...safeMeta,
      durationMs,
      httpStatus: res.status,
      ok: res.ok,
      responseContentType: contentType,
      responseBody: json != null ? redact(json) : redact({ rawTextPreview: text.slice(0, 2_000) }),
    };

    if (!res.ok) {
      const authFail = res.status === 401 || res.status === 403;
      throw new SupplierRuntimeError(
        authFail ? SupplierErrorCode.AUTH_FAILED : SupplierErrorCode.HTTP,
        `Supplier HTTP ${res.status}`,
        {
          ...responseMeta,
          // Keep a small unredacted status hint only — body already redacted in meta.
        },
      );
    }

    if (text && json == null && /json/i.test(contentType)) {
      throw new SupplierRuntimeError(
        SupplierErrorCode.MALFORMED,
        'Supplier returned invalid JSON',
        responseMeta,
      );
    }

    return {
      ok: true,
      status: res.status,
      durationMs,
      headers: Object.fromEntries(res.headers.entries()),
      data: json,
      text: json == null ? text : undefined,
      meta: responseMeta,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    if (err instanceof SupplierRuntimeError) {
      err.details = { ...(err.details || {}), durationMs };
      throw err;
    }
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new SupplierRuntimeError(
        SupplierErrorCode.TIMEOUT,
        `Supplier request timed out after ${timeoutMs}ms`,
        { ...safeMeta, durationMs },
      );
    }
    throw new SupplierRuntimeError(
      SupplierErrorCode.NETWORK,
      err instanceof Error ? err.message : 'Supplier network error',
      { ...safeMeta, durationMs },
    );
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

module.exports = {
  supplierHttpRequest,
  sanitizeHeadersForLog,
  buildUrl,
  defaultTimeoutMs,
};
