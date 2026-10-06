'use strict';

/**
 * Report readiness of Backend / B2C / DSAAdmin / APLAdmin (Phase 15).
 * Distinguishes unavailable vs not-ready vs ready vs route errors.
 */

const {
  fetchJson,
  classifyFetchResult,
  waitForBackendReady,
} = require('./lib/wait-for-ready');

const BACKEND = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3000';
const B2C = process.env.B2C_ORIGIN || 'http://127.0.0.1:3001';
const DSA_ADMIN = process.env.DSA_ADMIN_ORIGIN || 'http://127.0.0.1:3002';
const APL_ADMIN = process.env.APL_ADMIN_ORIGIN || 'http://127.0.0.1:3003';
const WAIT = String(process.env.DEV_STATUS_WAIT || '').toLowerCase() === 'true';

async function probe(name, url, { readyProbe = false } = {}) {
  if (readyProbe && WAIT) {
    const waited = await waitForBackendReady(BACKEND, { timeoutMs: 30000 });
    return {
      name,
      url,
      kind: waited.ok ? 'READY' : waited.kind,
      status: waited.status,
      detail: waited.ok ? 'ready' : waited.error || waited.kind,
    };
  }

  const result = await fetchJson(url, { timeoutMs: 4000 });
  const classified = classifyFetchResult(result);
  let detail = classified.kind;
  if (readyProbe && result.body?.data?.reason) {
    detail = `${classified.kind} (${result.body.data.reason})`;
  } else if (classified.kind === 'NOT_READY' && result.body?.data?.pending) {
    detail = `NOT_READY pending=${(result.body.data.pending || []).join(',')}`;
  } else if (classified.error) {
    detail = classified.error;
  }
  return {
    name,
    url,
    kind: classified.kind,
    status: classified.status,
    detail,
  };
}

async function main() {
  const rows = [
    await probe('Backend liveness', `${BACKEND}/health`),
    await probe('Backend readiness', `${BACKEND}/ready`, { readyProbe: true }),
    await probe('B2C', `${B2C}/`),
    await probe('DSAAdmin', `${DSA_ADMIN}/login`),
    await probe('APLAdmin', `${APL_ADMIN}/login`),
  ];

  let allReady = true;
  for (const row of rows) {
    const ok = row.kind === 'READY' || (row.name.includes('liveness') && row.status === 200);
    if (!ok && !row.name.includes('liveness')) allReady = false;
    const mark = ok ? '✓' : '✗';
    console.log(
      `${mark} ${row.name.padEnd(20)} ${String(row.status ?? '-').padStart(3)}  ${row.kind}  ${row.detail}`,
    );
  }

  if (!allReady) process.exit(1);
  console.log('All services ready.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
