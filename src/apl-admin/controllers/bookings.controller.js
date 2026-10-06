'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const ops = require('../../payments/services/ops-booking.service');

function actor(req) {
  return { id: req.admin?.id, email: req.admin?.email, type: 'APL' };
}

async function listBookings(req, res) {
  const data = await ops.listBookings({
    query: req.query || {},
    audience: 'APL',
  });
  return sendSuccess(res, data);
}

async function getBooking(req, res) {
  const detail = await ops.getBookingDetail({
    aplBookingRef: req.params.aplBookingRef,
    audience: 'APL',
  });
  ops.auditInspect({
    actor: actor(req),
    action: 'BOOKING_VIEW',
    resourceType: 'Booking',
    resourceId: detail.aplBookingRef,
    details: { dsaId: detail.dsaId },
  });
  return sendSuccess(res, { booking: detail });
}

async function listPayments(req, res) {
  return sendSuccess(
    res,
    await ops.listPayments({ query: req.query || {} }),
  );
}

async function listRefunds(req, res) {
  return sendSuccess(
    res,
    await ops.listRefunds({ query: req.query || {} }),
  );
}

module.exports = {
  listBookings,
  getBooking,
  listPayments,
  listRefunds,
};
