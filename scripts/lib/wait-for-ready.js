'use strict';

/**
 * Bounded wait helpers for dependency readiness (Phase 15).
 * Distinguishes unavailable / starting / ready / real HTTP errors.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify a probe attempt outcome.
 * @returns {{ kind: string, status: number|null, body: any, error?: string }}
 */
function classifyFetchResult({ status, body, networkError }) {
  if (networkError) {
    const code = networkError.code || '';
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNRESET' ||
      String(networkError.message || '').includes('fetch failed')
    ) {
      return {
        kind: 'UNAVAILABLE',
        status: null,
        body: null,
        error: networkError.message || String(networkError),
      };
    }
    return {
      kind: 'NETWORK_ERROR',
      status: null,
      body: null,
      error: networkError.message || String(networkError),
    };
  }

  if (status === 503) {
    return { kind: 'NOT_READY', status, body };
  }
  if (status === 404) {
    return { kind: 'ROUTE_NOT_FOUND', status, body };
  }
  if (status >= 500) {
    return { kind: 'SERVER_ERROR', status, body };
  }
  if (status >= 200 && status < 300) {
    return { kind: 'READY', status, body };
  }
  return { kind: 'UNEXPECTED_STATUS', status, body };
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json, networkError: null };
  } catch (error) {
    return { status: null, body: null, networkError: error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until GET /ready returns 200, with bounded retries.
 * Does not retry genuine 404/5xx forever — only UNAVAILABLE / NOT_READY.
 */
async function waitForBackendReady(baseUrl, options = {}) {
  const {
    timeoutMs = 60000,
    initialDelayMs = 200,
    maxDelayMs = 2000,
    requestTimeoutMs = 4000,
    onAttempt,
  } = options;

  const readyUrl = `${String(baseUrl).replace(/\/$/, '')}/ready`;
  const started = Date.now();
  let delay = initialDelayMs;
  let attempt = 0;

  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    const result = await fetchJson(readyUrl, { timeoutMs: requestTimeoutMs });
    const classified = classifyFetchResult(result);
    if (typeof onAttempt === 'function') {
      onAttempt({ attempt, ...classified, elapsedMs: Date.now() - started });
    }

    if (classified.kind === 'READY') {
      return { ok: true, attempts: attempt, elapsedMs: Date.now() - started, ...classified };
    }

    // Do not mask real route/server failures with endless retries.
    if (
      classified.kind === 'ROUTE_NOT_FOUND' ||
      classified.kind === 'SERVER_ERROR' ||
      classified.kind === 'UNEXPECTED_STATUS'
    ) {
      return {
        ok: false,
        attempts: attempt,
        elapsedMs: Date.now() - started,
        fatal: true,
        ...classified,
      };
    }

    await sleep(delay);
    delay = Math.min(maxDelayMs, Math.round(delay * 1.5));
  }

  return {
    ok: false,
    attempts: attempt,
    elapsedMs: Date.now() - started,
    fatal: false,
    kind: 'TIMEOUT',
    status: null,
    body: null,
    error: `Timed out waiting for ${readyUrl}`,
  };
}

async function waitForHttpOk(url, options = {}) {
  const {
    timeoutMs = 60000,
    initialDelayMs = 200,
    maxDelayMs = 2000,
    requestTimeoutMs = 4000,
    acceptStatuses = [200],
    onAttempt,
  } = options;

  const started = Date.now();
  let delay = initialDelayMs;
  let attempt = 0;

  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    const result = await fetchJson(url, { timeoutMs: requestTimeoutMs });
    const classified = classifyFetchResult(result);
    const accepted =
      result.status != null && acceptStatuses.includes(result.status);

    if (typeof onAttempt === 'function') {
      onAttempt({
        attempt,
        ...classified,
        accepted,
        elapsedMs: Date.now() - started,
      });
    }

    if (accepted) {
      return { ok: true, attempts: attempt, elapsedMs: Date.now() - started, ...classified };
    }

    if (classified.kind === 'ROUTE_NOT_FOUND' && !acceptStatuses.includes(404)) {
      // For frontends, '/' should exist — treat 404 as fatal.
      return {
        ok: false,
        attempts: attempt,
        elapsedMs: Date.now() - started,
        fatal: true,
        ...classified,
      };
    }

    if (classified.kind === 'SERVER_ERROR') {
      // Transient Next compile can 500 briefly — allow limited continue until timeout.
      await sleep(delay);
      delay = Math.min(maxDelayMs, Math.round(delay * 1.5));
      continue;
    }

    await sleep(delay);
    delay = Math.min(maxDelayMs, Math.round(delay * 1.5));
  }

  return {
    ok: false,
    attempts: attempt,
    elapsedMs: Date.now() - started,
    fatal: false,
    kind: 'TIMEOUT',
    status: null,
    body: null,
    error: `Timed out waiting for ${url}`,
  };
}

module.exports = {
  sleep,
  fetchJson,
  classifyFetchResult,
  waitForBackendReady,
  waitForHttpOk,
};
