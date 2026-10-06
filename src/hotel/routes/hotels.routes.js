'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
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
    const dto = validateHotelSearchBody(req.body);
    const forced = parseFailureHeader(req.header('x-simulate-supplier-failure'));
    const result = await searchHotels(dto, forced.length > 0 ? forced : undefined, {
      requestId: req.requestId,
      userId: req.user?._id,
      dsaId: req.tenant?.dsaId,
      tenant: req.tenant,
    });
    return sendSuccess(res, sanitizeHotelSearchForPublic(result));
  }),
);

/** Step 3 — hotel + available rooms. POST /api/v1/hotels/details */
router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const dto = validateHotelDetailsBody(req.body);
    return sendSuccess(res, await getHotelDetails(dto, { tenant: req.tenant }));
  }),
);

/** Step 4 — confirm selected room is still available. */
router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const dto = validateHotelRoomLookup(req.body);
    return sendSuccess(res, await revalidateHotelOffer(dto, { tenant: req.tenant }));
  }),
);

/** Step 5 — checkout page (guests → checkoutToken). */
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const dto = validateHotelCheckoutBody(req.body);
    return sendSuccess(
      res,
      await checkoutHotel(dto, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

/** Step 6 — dummy payment + confirm booking. */
router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    const dto = validateHotelBookBody(req.body);
    return sendSuccess(
      res,
      await bookHotel(dto, req.user, {
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
