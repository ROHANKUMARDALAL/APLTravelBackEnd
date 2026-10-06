'use strict';

/**
 * Readiness-aware travel search smoke tests (Phase 15).
 * Waits for GET /ready before any API smoke call.
 * Covers Flight, Hotel, Bus, Transfer via B2C proxy (or direct backend).
 */

const {
  waitForBackendReady,
  waitForHttpOk,
  fetchJson,
} = require('./lib/wait-for-ready');

const BACKEND = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3000';
const B2C = process.env.B2C_ORIGIN || 'http://127.0.0.1:3001';
const USE_PROXY = String(process.env.SMOKE_VIA_B2C || 'true').toLowerCase() !== 'false';
const TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 90000);
const HOST_HEADER = process.env.SMOKE_PUBLIC_HOST || 'localhost:3001';

function apiBase() {
  return USE_PROXY ? `${B2C}/api/v1` : `${BACKEND}/api/v1`;
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (!USE_PROXY) h['X-APL-Public-Host'] = HOST_HEADER;
  return h;
}

async function postSearch(path, body) {
  const url = `${apiBase()}${path}`;
  const result = await fetchJson(url, {
    method: 'POST',
    headers: headers(),
    body,
    timeoutMs: 30000,
  });
  return { url, ...result };
}

function assertSearchOk(label, result) {
  if (result.networkError) {
    throw new Error(
      `${label}: service unavailable (${result.networkError.message || result.networkError})`,
    );
  }
  if (result.status === 404) {
    throw new Error(`${label}: actual route 404 at ${result.url}`);
  }
  if (result.status === 503) {
    throw new Error(`${label}: dependency/not ready (503)`);
  }
  if (result.status == null || result.status >= 500) {
    throw new Error(`${label}: server error status=${result.status}`);
  }
  if (result.status !== 200 || !result.body?.success) {
    const msg =
      result.body?.error?.ErrorMessage ||
      result.body?.error?.message ||
      JSON.stringify(result.body?.error || result.body);
    throw new Error(`${label}: expected success 200, got ${result.status} ${msg}`);
  }
  return result.body.data;
}

async function main() {
  console.log('Phase 15 smoke: wait for readiness, then search APIs');
  console.log(`Mode: ${USE_PROXY ? 'B2C proxy' : 'direct backend'}`);

  const ready = await waitForBackendReady(BACKEND, {
    timeoutMs: TIMEOUT_MS,
    onAttempt: (info) => {
      if (info.attempt === 1 || info.kind !== 'NOT_READY') {
        console.log(
          `[ready] attempt=${info.attempt} kind=${info.kind} status=${info.status ?? '-'}`,
        );
      }
    },
  });
  if (!ready.ok) {
    console.error('Backend never became ready:', ready);
    process.exit(1);
  }
  console.log(`✓ Backend /ready OK (${ready.elapsedMs}ms)`);

  if (USE_PROXY) {
    const b2c = await waitForHttpOk(`${B2C}/`, { timeoutMs: TIMEOUT_MS });
    if (!b2c.ok) {
      console.error('B2C not ready:', b2c);
      process.exit(1);
    }
    console.log(`✓ B2C OK (${b2c.elapsedMs}ms)`);
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 30);
  const date = tomorrow.toISOString().slice(0, 10);

  const flight = assertSearchOk(
    'Flight',
    await postSearch('/flights/search', {
      tripType: 'ONEWAY',
      originCityCode: 'DEL',
      destinationCityCode: 'BOM',
      departDate: date,
      adults: 1,
      children: 0,
      infants: 0,
      currency: 'INR',
    }),
  );
  console.log(`✓ Flight search OK (searchId=${flight?.searchId || 'n/a'})`);

  const hotel = assertSearchOk(
    'Hotel',
    await postSearch('/hotels/search', {
      cityCode: '130443',
      checkIn: date,
      checkOut: (() => {
        const d = new Date(date);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })(),
      rooms: 1,
      adults: 2,
      children: 0,
      currency: 'INR',
    }),
  );
  console.log(`✓ Hotel search OK (searchId=${hotel?.searchId || 'n/a'})`);

  const bus = assertSearchOk(
    'Bus',
    await postSearch('/buses/search', {
      from: 'New York',
      to: 'Boston',
      travelDate: date,
      adults: 1,
    }),
  );
  console.log(`✓ Bus search OK (searchId=${bus?.searchId || 'n/a'})`);

  const transfer = assertSearchOk(
    'Transfer',
    await postSearch('/transfers/search', {
      pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
      dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
      pickupDate: date,
      pickupTime: '14:30',
      passengers: 2,
    }),
  );
  console.log(
    `✓ Transfer search OK (searchId=${transfer?.searchId || 'n/a'}, count=${(transfer?.transfers || []).length})`,
  );

  console.log('Smoke passed.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
