'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { logPublicSearchResult } = require('../../common/services/lifecycle-log.service');
const { requireLogin, optionalLogin } = require('../../common/middleware/require-login');
const {
  requireTransactionTenant,
  requireOfferedService,
} = require('../../tenant/middleware/require-transaction-tenant');
const {
  searchHotels,
  getHotelDetails,
  revalidateHotelOffer,
  sanitizeHotelSearchForPublic,
} = require('../services/hotel-search.service');
const {
  checkoutHotel,
  bookHotel,
  listHotelBookings,
  getHotelBookingDetails,
  cancelHotelBooking,
} = require('../services/hotel-booking.service');
const {
  validateCitySearchBody,
  searchCities,
} = require('../services/city-search.service');
const {
  validateHotelSearchBody,
  parseFailureHeader,
  validateHotelDetailsBody,
  validateHotelRoomLookup,
  validateHotelCheckoutBody,
  validateHotelBookBody,
} = require('../validators/hotel-search.validation');

const router = express.Router();

// Phase 9: trusted host → DSA; offer rule; ignore client dsaId.
router.use(requireTransactionTenant, requireOfferedService('hotel'));

/** Step 1 — search cities. POST /api/v1/hotels/cities/search */
router.post(
  '/cities/search',
  asyncHandler(async (req, res) => {
    const dto = validateCitySearchBody(req.body);
    return sendSuccess(res, searchCities(dto));
  }),
);

/** Step 2 — hotels in the selected city. POST /api/v1/hotels/search */
router.post(
  '/search',
  optionalLogin,
  asyncHandler(async (req, res) => {
    req.logService = 'HOTEL';
    req.businessOperation = 'SEARCH';
    const dto = validateHotelSearchBody(req.body);
    const forced = parseFailureHeader(req.header('x-simulate-supplier-failure'));
    const result = await searchHotels(dto, forced.length > 0 ? forced : undefined, {
      requestId: req.requestId,
      userId: req.user?._id,
      dsaId: req.tenant?.dsaId,
      tenant: req.tenant,
    });
    const publicResult = sanitizeHotelSearchForPublic(result);
    req.businessOperation = 'SEARCH';
    req.searchId = result.searchId;
    req.journeyId = result.searchId;
    await logPublicSearchResult({
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      service: 'HOTEL',
      searchId: result.searchId,
      journeyId: result.searchId,
      businessOperation: 'SEARCH',
      payload: publicResult,
    });
    return sendSuccess(res, publicResult);
  }),
);

/** Step 3 — hotel + available rooms. POST /api/v1/hotels/details */
router.post(
  '/details',
  asyncHandler(async (req, res) => {
    req.logService = 'HOTEL';
    req.businessOperation = 'DETAILS';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateHotelDetailsBody(req.body);
    const details = await getHotelDetails(dto, { tenant: req.tenant });
    req.searchId = details.searchId || req.searchId;
    req.journeyId = details.searchId || req.journeyId;
    return sendSuccess(res, details);
  }),
);

/** Step 4 — confirm selected room is still available. */
router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    req.logService = 'HOTEL';
    req.businessOperation = 'RECHECK';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateHotelRoomLookup(req.body);
    const checked = await revalidateHotelOffer(dto, {
      tenant: req.tenant,
      supplier: req.body?.supplier || null,
    });
    req.searchId = checked.searchId || req.searchId;
    req.journeyId = checked.searchId || req.journeyId;
    return sendSuccess(res, checked);
  }),
);

/** Step 5 — checkout page (guests → checkoutToken). */
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    req.logService = 'HOTEL';
    req.businessOperation = 'CHECKOUT';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateHotelCheckoutBody(req.body);
    const session = await checkoutHotel(dto, {
        tenant: req.tenant,
        requestId: req.requestId,
        couponCode: req.body?.couponCode,
      });
    req.searchId = session.searchId || req.searchId;
    req.journeyId = session.journeyId || session.searchId || req.journeyId;
    return sendSuccess(res, session);
  }),
);

/** Step 6 — dummy payment + confirm booking. */
router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    req.logService = 'HOTEL';
    req.businessOperation = 'BOOK';
    req.searchId = req.body?.searchId;
    const dto = validateHotelBookBody(req.body);
    const booked = await bookHotel(dto, req.user, {
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
      await listHotelBookings(req.user._id, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/bookings/details',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await getHotelBookingDetails(req.body || {}, req.user, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/bookings/cancel',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await cancelHotelBooking(req.body || {}, req.user, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

module.exports = router;
