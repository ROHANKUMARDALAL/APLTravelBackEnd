'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { logPublicSearchResult } = require('../../common/services/lifecycle-log.service');
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
const { changeBusPoints } = require('../services/bus-point-change.service');
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
    req.logService = 'BUS';
    req.businessOperation = 'SEARCH';
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
    const publicResult = sanitizeBusSearchForPublic(result);
    req.businessOperation = 'SEARCH';
    req.searchId = result.searchId;
    req.journeyId = result.searchId;
    await logPublicSearchResult({
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      service: 'BUS',
      searchId: result.searchId,
      journeyId: result.searchId,
      businessOperation: 'SEARCH',
      payload: publicResult,
    });
    return sendSuccess(res, publicResult);
  }),
);

router.post(
  '/details',
  asyncHandler(async (req, res) => {
    req.logService = 'BUS';
    req.businessOperation = 'DETAILS';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateBusLookupBody(req.body);
    const details = await getBusDetails(dto, { tenant: req.tenant });
    req.searchId = details.searchId || req.searchId;
    req.journeyId = details.searchId || req.journeyId;
    return sendSuccess(res, details);
  }),
);

router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    req.logService = 'BUS';
    req.businessOperation = 'RECHECK';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateBusLookupBody(req.body);
    const checked = await revalidateBusOffer(dto, {
      tenant: req.tenant,
      supplier: req.body?.supplier || null,
    });
    req.searchId = checked.searchId || req.searchId;
    req.journeyId = checked.searchId || req.journeyId;
    return sendSuccess(res, checked);
  }),
);

router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    req.logService = 'BUS';
    req.businessOperation = 'CHECKOUT';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateBusCheckoutBody(req.body);
    const session = await checkoutBus(dto, {
      tenant: req.tenant,
      requestId: req.requestId,
      couponCode: req.body?.couponCode,
    });
    req.searchId = session.searchId || req.searchId;
    req.journeyId = session.journeyId || session.searchId || req.journeyId;
    return sendSuccess(res, session);
  }),
);

router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    req.logService = 'BUS';
    req.businessOperation = 'BOOK';
    req.searchId = req.body?.searchId;
    const dto = validateBusBookBody(req.body);
    const booked = await bookBus(dto, req.user, {
      tenant: req.tenant,
      requestId: req.requestId,
    });
    req.businessOperation = 'BOOK';
    req.searchId = booked.searchId || req.body?.searchId;
    req.journeyId = booked.journeyId || booked.searchId || req.body?.searchId;
    return sendSuccess(res, booked);
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
  '/bookings/points',
  requireLogin,
  asyncHandler(async (req, res) => {
    req.logService = 'BUS';
    req.businessOperation = 'POINT_CHANGE';
    const changed = await changeBusPoints(req.body || {}, req.user, {
      tenant: req.tenant,
      requestId: req.requestId,
      request: req,
    });
    req.searchId = changed.searchId;
    req.journeyId = changed.journeyId || changed.searchId;
    return sendSuccess(res, changed);
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
