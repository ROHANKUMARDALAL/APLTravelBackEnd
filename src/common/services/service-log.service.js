'use strict';

const { writeLifecycleLog } = require('./lifecycle-log.service');

/** Never let logging break the API call that produced the log. */
async function writeServiceLog(entry) {
  const stage =
    entry.stage ||
    (entry.direction === 'SUPPLIER' ? 'SUPPLIER_RESPONSE' : 'OUTBOUND_RESPONSE');
  await writeLifecycleLog({
    ...entry,
    stage,
    status:
      entry.status ||
      (entry.httpStatus && entry.httpStatus >= 400 ? 'FAILED' : 'SUCCESS'),
  });
}

function serviceFromPath(path) {
  if (path.includes('/transfers')) return 'TRANSFER';
  if (path.includes('/buses')) return 'BUS';
  if (path.includes('/hotels')) return 'HOTEL';
  if (path.includes('/flights')) return 'FLIGHT';
  if (path.includes('/auth')) return 'AUTH';
  if (path.includes('/account')) return 'ACCOUNT';
  if (path.includes('/bookings')) return 'BOOKING';
  if (path.includes('/suppliers')) return 'SUPPLIER';
  if (path.includes('/health') || path.includes('/ready')) return 'HEALTH';
  return 'OTHER';
}

async function logSupplierOutcomes({
  requestId,
  dsaId,
  userId,
  service,
  operation,
  searchId,
  userRequest,
  settled,
}) {
  await Promise.all(
    settled.map(async ({ adapter, outcome, supplierId }) => {
      const base = {
        requestId,
        dsaId,
        userId,
        service,
        operation,
        supplierCode: adapter.code,
        supplierId,
        searchId,
        request: userRequest,
      };

      await writeLifecycleLog({
        ...base,
        stage: 'SUPPLIER_REQUEST',
        direction: 'SUPPLIER',
        status: 'SUCCESS',
        httpStatus: 200,
        durationMs: 0,
        storeRaw: true,
        rawPayload: outcome.supplierRequest || userRequest || {},
        supplierRequest: outcome.supplierRequest || null,
      });

      await writeLifecycleLog({
        ...base,
        stage: 'SUPPLIER_RESPONSE',
        direction: 'SUPPLIER',
        status: outcome.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        httpStatus: outcome.status === 'SUCCESS' ? 200 : 502,
        durationMs: outcome.durationMs,
        storeRaw: true,
        rawPayload:
          outcome.status === 'SUCCESS'
            ? outcome.rawPayload
            : {
                errorCode: outcome.errorCode,
                errorMessage: outcome.errorMessage,
                errorDetails: outcome.errorDetails,
              },
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
    }),
  );
}

module.exports = { writeServiceLog, serviceFromPath, logSupplierOutcomes };
