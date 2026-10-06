'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const {
  requireLogin,
  optionalLogin,
} = require('../../common/middleware/require-login');
const {
  requireTransactionTenant,
  requireOfferedService,
} = require('../../tenant/middleware/require-transaction-tenant');
const {
  searchTransfers,
  getTransferDetails,
  revalidateTransferOffer,
  sanitizeTransferSearchForPublic,
  searchAplTransferLocations,
} = require('../services/transfer-search.service');
const {
  checkoutTransfer,
  bookTransfer,
  listTransferBookings,
  getTransferBookingDetails,
  cancelTransferBooking,
} = require('../services/transfer-booking.service');
const {
  validateTransferSearchBody,
  parseFailureHeader,
  validateTransferLookupBody,
  validateTransferCheckoutBody,
  validateTransferBookBody,
  validateLocationSearchBody,
} = require('../validators/transfer.validation');

const router = express.Router();

router.use(requireTransactionTenant, requireOfferedService('transfer'));

router.post(
  '/locations/search',
  asyncHandler(async (req, res) => {
    const dto = validateLocationSearchBody(req.body);
    return sendSuccess(res, {
      locations: searchAplTransferLocations(dto.query),
    });
  }),
);

router.post(
  '/search',
  optionalLogin,
  asyncHandler(async (req, res) => {
    const dto = validateTransferSearchBody(req.body);
    const forced = parseFailureHeader(req.header('x-simulate-supplier-failure'));
    const result = await searchTransfers(
      dto,
      forced.length > 0 ? forced : undefined,
      {
        requestId: req.requestId,
        userId: req.user?._id,
        dsaId: req.tenant?.dsaId,
        tenant: req.tenant,
      },
    );
    return sendSuccess(res, sanitizeTransferSearchForPublic(result));
  }),
);

router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const dto = validateTransferLookupBody(req.body);
    return sendSuccess(res, await getTransferDetails(dto, { tenant: req.tenant }));
  }),
);

router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const dto = validateTransferLookupBody(req.body);
    return sendSuccess(
      res,
      await revalidateTransferOffer(dto, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const dto = validateTransferCheckoutBody(req.body);
    return sendSuccess(
      res,
      await checkoutTransfer(dto, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    const dto = validateTransferBookBody(req.body);
    return sendSuccess(
      res,
      await bookTransfer(dto, req.user, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

router.get(
  '/bookings',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await listTransferBookings(req.user._id, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/bookings/details',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await getTransferBookingDetails(req.body || {}, req.user, {
        tenant: req.tenant,
      }),
    );
  }),
);

router.post(
  '/bookings/cancel',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await cancelTransferBooking(req.body || {}, req.user, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

module.exports = router;
