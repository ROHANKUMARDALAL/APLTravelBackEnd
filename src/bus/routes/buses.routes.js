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
  searchBuses,
  getBusDetails,
  revalidateBusOffer,
  sanitizeBusSearchForPublic,
  searchAplBusLocations,
} = require('../services/bus-search.service');
const {
  checkoutBus,
  bookBus,
  listBusBookings,
  getBusBookingDetails,
  cancelBusBooking,
} = require('../services/bus-booking.service');
const {
  validateBusSearchBody,
  parseFailureHeader,
  validateBusLookupBody,
  validateBusCheckoutBody,
  validateBusBookBody,
  validateLocationSearchBody,
} = require('../validators/bus.validation');

const router = express.Router();

router.use(requireTransactionTenant, requireOfferedService('bus'));

router.post(
  '/locations/search',
  asyncHandler(async (req, res) => {
    const dto = validateLocationSearchBody(req.body);
    return sendSuccess(res, {
      locations: searchAplBusLocations(dto.query),
    });
  }),
);

router.post(
  '/search',
  optionalLogin,
  asyncHandler(async (req, res) => {
    const dto = validateBusSearchBody(req.body);
    const forced = parseFailureHeader(req.header('x-simulate-supplier-failure'));
    const result = await searchBuses(
      dto,
      forced.length > 0 ? forced : undefined,
      {
        requestId: req.requestId,
        userId: req.user?._id,
        dsaId: req.tenant?.dsaId,
        tenant: req.tenant,
      },
    );
    return sendSuccess(res, sanitizeBusSearchForPublic(result));
  }),
);

router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const dto = validateBusLookupBody(req.body);
    return sendSuccess(res, await getBusDetails(dto, { tenant: req.tenant }));
  }),
);

router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const dto = validateBusLookupBody(req.body);
    return sendSuccess(
      res,
      await revalidateBusOffer(dto, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const dto = validateBusCheckoutBody(req.body);
    return sendSuccess(
      res,
      await checkoutBus(dto, {
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
    const dto = validateBusBookBody(req.body);
    return sendSuccess(
      res,
      await bookBus(dto, req.user, {
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
      await listBusBookings(req.user._id, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/bookings/details',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await getBusBookingDetails(req.body || {}, req.user, {
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
      await cancelBusBooking(req.body || {}, req.user, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

module.exports = router;
