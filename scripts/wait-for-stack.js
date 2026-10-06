'use strict';

/**
 * Wait until the local APL stack is ready (Phase 15).
 * Backend must pass GET /ready (dependency readiness), not merely /health.
 */

const {
  waitForBackendReady,
  waitForHttpOk,
} = require('./lib/wait-for-ready');

const BACKEND = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3000';
const B2C = process.env.B2C_ORIGIN || 'http://127.0.0.1:3001';
const DSA_ADMIN = process.env.DSA_ADMIN_ORIGIN || 'http://127.0.0.1:3002';
const APL_ADMIN = process.env.APL_ADMIN_ORIGIN || 'http://127.0.0.1:3003';
const TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 90000);

function logAttempt(label, info) {
  const status = info.status == null ? '-' : info.status;
  console.log(
    `[wait] ${label} attempt=${info.attempt} kind=${info.kind} status=${status} elapsed=${info.elapsedMs}ms`,
  );
}

async function main() {
  console.log('Waiting for APL stack readiness…');
  console.log(`Backend:   ${BACKEND}/ready`);
  console.log(`B2C:       ${B2C}/`);
  console.log(`DSAAdmin:  ${DSA_ADMIN}/login`);
  console.log(`APLAdmin:  ${APL_ADMIN}/login`);

  const backend = await waitForBackendReady(BACKEND, {
    timeoutMs: TIMEOUT_MS,
    onAttempt: (info) => logAttempt('backend/ready', info),
  });
  if (!backend.ok) {
    console.error('Backend NOT READY:', backend.kind, backend.error || backend.body);
    process.exit(1);
  }
  console.log(`✓ Backend ready (${backend.elapsedMs}ms, ${backend.attempts} attempts)`);

  const targets = [
    { name: 'B2C', url: `${B2C}/` },
    { name: 'DSAAdmin', url: `${DSA_ADMIN}/login` },
    { name: 'APLAdmin', url: `${APL_ADMIN}/login` },
  ];

  for (const target of targets) {
    const result = await waitForHttpOk(target.url, {
      timeoutMs: TIMEOUT_MS,
      onAttempt: (info) => logAttempt(target.name, info),
    });
    if (!result.ok) {
      console.error(`${target.name} NOT READY:`, result.kind, result.error || '');
      process.exit(1);
    }
    console.log(`✓ ${target.name} ready (${result.elapsedMs}ms)`);
  }

  console.log('Stack ready.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
