'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const { AppError } = require('../../common/errors/app-error');
const ops = require('../../payments/services/ops-booking.service');

function trustedDsaId(req) {
  return req.tenant?.dsaId || req.adminSession?.dsaId || null;
}

async function listBookings(req, res) {
  const dsaId = trustedDsaId(req);
  if (!dsaId) throw AppError.forbidden('DSA context required');
  // Never accept client dsaId — always use authenticated tenant.
  return sendSuccess(
    res,
    await ops.listBookings({
      query: { ...(req.query || {}), dsaId: undefined },
      dsaScope: dsaId,
      audience: 'DSA',
    }),
  );
}

async function getBooking(req, res) {
  const dsaId = trustedDsaId(req);
  if (!dsaId) throw AppError.forbidden('DSA context required');
  const detail = await ops.getBookingDetail({
    aplBookingRef: req.params.aplBookingRef,
    dsaScope: dsaId,
    audience: 'DSA',
  });
  return sendSuccess(res, { booking: detail });
}

module.exports = { listBookings, getBooking };
