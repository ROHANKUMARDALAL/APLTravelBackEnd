'use strict';

const ServiceLog = require('../database/models/ServiceLog');
const { redact } = require('../utils/redact');

function trim(value) {
  const clean = redact(value);
  const text = JSON.stringify(clean);
  if (!text || text.length <= 80_000) return clean;
  return { truncated: true, preview: text.slice(0, 80_000) };
}

/** Never let logging break the API call that produced the log. */
async function writeServiceLog(entry) {
  try {
    await ServiceLog.create({
      requestId: entry.requestId || null,
      userId: entry.userId || undefined,
      direction: entry.direction,
      service: entry.service,
      operation: entry.operation,
      supplierCode: entry.supplierCode,
      searchId: entry.searchId,
      httpStatus: entry.httpStatus,
      durationMs: entry.durationMs,
      request: trim(entry.request),
      supplierRequest: entry.supplierRequest ? trim(entry.supplierRequest) : undefined,
      result: trim(entry.result),
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
    });
  } catch (err) {
    console.error('Service log write failed:', err.message);
  }
}

function serviceFromPath(path) {
  if (path.includes('/hotels')) return 'HOTEL';
  if (path.includes('/flights')) return 'FLIGHT';
  if (path.includes('/auth')) return 'AUTH';
  if (path.includes('/account')) return 'ACCOUNT';
  if (path.includes('/bookings')) return 'BOOKING';
  if (path.includes('/suppliers')) return 'SUPPLIER';
  if (path.includes('/health')) return 'HEALTH';
  return 'OTHER';
}

module.exports = { writeServiceLog, serviceFromPath, logSupplierOutcomes };

async function logSupplierOutcomes({
  requestId,
  userId,
  service,
  operation,
  searchId,
  userRequest,
  settled,
}) {
  await Promise.all(
    settled.map(({ adapter, outcome }) =>
      writeServiceLog({
        direction: 'SUPPLIER',
        requestId,
        userId,
        service,
        operation,
        supplierCode: adapter.code,
        searchId,
        httpStatus: outcome.status === 'SUCCESS' ? 200 : 502,
        durationMs: outcome.durationMs,
        request: userRequest,
        supplierRequest: outcome.supplierRequest || null,
        result:
          outcome.status === 'SUCCESS'
            ? outcome.rawPayload
            : { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage },
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      }),
    ),
  );
}
