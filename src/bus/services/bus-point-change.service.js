'use strict';

const { AppError } = require('../../common/errors/app-error');
const { Booking } = require('../../common/database/models/Booking');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const { assertBookingTenantAccess } = require('../../tenant/services/transaction-tenant.service');
const { getBusAdapter } = require('../suppliers/registry');
const { canChangePoints } = require('../utils/point-window');
const { getBookingByRef } = require('../../common/services/checkout-booking.service');

function pickPoint(points, code) {
  return (points || []).find((point) => String(point.code) === String(code)) || null;
}

function publicPoint(point) {
  if (!point) return null;
  return {
    code: point.code,
    name: point.name,
    time: point.time || null,
    timeOffsetMinutes: point.timeOffsetMinutes ?? null,
    address: point.address || '',
    landmark: point.landmark || '',
  };
}

function clock(context) {
  return context.now instanceof Date ? context.now : new Date();
}

async function changeBusPoints(body, user, context = {}) {
  const started = Date.now();
  const bookingId = String(body.bookingId || body.aplBookingRef || '').trim();
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  const logBase = {
    requestId: context.requestId,
    userId: user?._id,
    service: 'BUS',
    operation: 'POINT_CHANGE',
    businessOperation: 'POINT_CHANGE',
  };

  async function record(partial) {
    await writeLifecycleLog({
      ...logBase,
      durationMs: Date.now() - started,
      ...partial,
    });
  }

  async function reject(message, extra = {}) {
    await record({
      stage: 'OUTBOUND_RESPONSE',
      direction: 'INBOUND',
      status: 'FAILED',
      httpStatus: 400,
      errorMessage: message,
      result: {
        bookingId: bookingId || null,
        journeyId: logBase.journeyId || null,
        accepted: false,
        ...extra,
      },
    });
    throw AppError.validation(message);
  }

  if (!bookingId.startsWith('APL-BK-')) {
    await reject('bookingId is required (APL-BK-...)');
  }
  if (idempotencyKey.length < 8) {
    await reject('idempotencyKey is required', { bookingId });
  }

  const booking = await Booking.findOne({ aplBookingRef: bookingId, userId: user._id });
  if (!booking || booking.productType !== 'BUS') {
    await reject(`Bus booking not found: ${bookingId}`, { bookingId });
  }

  const saved = booking.services?.bus || {};
  const snap = booking.items?.[0]?.snapshot || {};
  const journeyId = booking.journeyId || booking.searchId || null;
  logBase.journeyId = journeyId;
  logBase.searchId = booking.searchId;
  logBase.dsaId = booking.dsaId;
  const supplierCode = snap.supplier || booking.items?.[0]?.supplierCode || '';
  if (supplierCode) logBase.supplierCode = supplierCode;
  if (context.request) {
    context.request.journeyId = journeyId;
    context.request.searchId = booking.searchId;
  }

  const currentBoarding = publicPoint(saved.boardingPoint || snap.boardingPoint);
  const currentDropping = publicPoint(saved.droppingPoint || snap.droppingPoint);
  const requestPayload = {
    bookingId,
    journeyId,
    idempotencyKey,
    oldBoardingPointCode: currentBoarding?.code || null,
    oldDroppingPointCode: currentDropping?.code || null,
    boardingPointCode: body.boardingPointCode || currentBoarding?.code || null,
    droppingPointCode: body.droppingPointCode || currentDropping?.code || null,
  };
  await record({
    stage: 'INBOUND_REQUEST',
    direction: 'INBOUND',
    status: 'SUCCESS',
    request: requestPayload,
  });

  try {
    if (context.tenant) assertBookingTenantAccess(booking, context.tenant);
  } catch (error) {
    await record({
      stage: 'OUTBOUND_RESPONSE',
      direction: 'INBOUND',
      status: 'FAILED',
      httpStatus: error.httpStatus || 403,
      errorMessage: error.message,
      result: { ...requestPayload, accepted: false },
    });
    throw error;
  }

  if (String(booking.status).toUpperCase() !== 'CONFIRMED') {
    await reject('Only a confirmed bus booking can change points', requestPayload);
  }

  const history = Array.isArray(saved.pointChanges) ? saved.pointChanges : [];
  const replay = history.find((row) => row.idempotencyKey === idempotencyKey);
  if (replay) {
    await record({
      stage: 'OUTBOUND_RESPONSE',
      direction: 'INBOUND',
      status: 'SUCCESS',
      result: {
        ...requestPayload,
        accepted: true,
        replay: true,
        newBoardingPointCode: replay.newBoarding?.code || null,
        newDroppingPointCode: replay.newDropping?.code || null,
      },
    });
    return getBookingByRef(bookingId, user._id, { tenant: context.tenant });
  }

  const departureAt = saved.departureAt || snap.departureAt;
  if (!canChangePoints(departureAt, clock(context))) {
    await reject('Boarding and dropping points can be changed only until 2 hours before departure', requestPayload);
  }

  const boardingPoints = saved.boardingPoints || snap.boardingPoints || [];
  const droppingPoints = saved.droppingPoints || snap.droppingPoints || [];
  const boarding = pickPoint(boardingPoints, requestPayload.boardingPointCode);
  const dropping = pickPoint(droppingPoints, requestPayload.droppingPointCode);
  if (!boarding) await reject('Invalid boardingPointCode', requestPayload);
  if (!dropping) await reject('Invalid droppingPointCode', requestPayload);

  const supplierPayload = {
    bookingId,
    journeyId,
    boardingPointCode: boarding.code,
    droppingPointCode: dropping.code,
    idempotencyKey,
  };
  const adapter = getBusAdapter(supplierCode);
  if (!adapter?.isMock) {
    if (typeof adapter?.changePoints !== 'function') {
      await reject('This operator does not support boarding point changes yet', {
        ...requestPayload,
        supported: false,
      });
    }
  }
  await record({
    stage: 'SUPPLIER_REQUEST',
    direction: 'SUPPLIER',
    status: 'SUCCESS',
    supplierRequest: adapter?.isMock ? { ...supplierPayload, mock: true } : supplierPayload,
  });
  const supplierResult = await adapter.changePoints(supplierPayload);
  await record({
    stage: 'SUPPLIER_RESPONSE',
    direction: 'SUPPLIER',
    status: supplierResult?.accepted ? 'SUCCESS' : 'FAILED',
    result: supplierResult,
  });
  if (!supplierResult?.accepted) {
    await reject('The operator did not accept the point change', requestPayload);
  }

  const revision = Number(saved.pointRevision) || 0;
  const entry = {
    at: new Date().toISOString(),
    bookingRef: bookingId,
    customerId: String(user._id),
    idempotencyKey,
    oldBoarding: currentBoarding,
    newBoarding: publicPoint(boarding),
    oldDropping: currentDropping,
    newDropping: publicPoint(dropping),
  };
  const updated = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      userId: user._id,
      status: 'CONFIRMED',
      $or: [
        { 'services.bus.pointRevision': revision },
        { 'services.bus.pointRevision': { $exists: false } },
      ],
    },
    {
      $set: {
        'services.bus.boardingPoint': publicPoint(boarding),
        'services.bus.droppingPoint': publicPoint(dropping),
        'services.bus.pointRevision': revision + 1,
        'items.0.snapshot.boardingPoint': publicPoint(boarding),
        'items.0.snapshot.droppingPoint': publicPoint(dropping),
      },
      $push: { 'services.bus.pointChanges': entry },
    },
    { new: true },
  );
  if (!updated) {
    const fresh = await Booking.findById(booking._id).lean();
    const again = (fresh?.services?.bus?.pointChanges || []).find((row) => row.idempotencyKey === idempotencyKey);
    if (again) {
      await record({
        stage: 'OUTBOUND_RESPONSE',
        direction: 'INBOUND',
        status: 'SUCCESS',
        result: { ...requestPayload, accepted: true, replay: true },
      });
      return getBookingByRef(bookingId, user._id, { tenant: context.tenant });
    }
    await reject('This booking was updated at the same time. Refresh and try again.', requestPayload);
  }

  await record({
    stage: 'OUTBOUND_RESPONSE',
    direction: 'INBOUND',
    status: 'SUCCESS',
    result: {
      bookingId,
      journeyId,
      accepted: true,
      oldBoardingPointCode: currentBoarding?.code || null,
      newBoardingPointCode: boarding.code,
      oldDroppingPointCode: currentDropping?.code || null,
      newDroppingPointCode: dropping.code,
    },
  });
  return getBookingByRef(bookingId, user._id, { tenant: context.tenant });
}

module.exports = { changeBusPoints, publicPoint };
