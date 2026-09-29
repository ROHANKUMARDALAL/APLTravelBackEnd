'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { requireLogin, optionalLogin } = require('../../common/middleware/require-login');
const {
  searchHotels,
  getHotelDetails,
  revalidateHotelOffer,
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
    });
    return sendSuccess(res, result);
  }),
);

/** Step 3 — hotel + available rooms. POST /api/v1/hotels/details */
router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const dto = validateHotelDetailsBody(req.body);
    return sendSuccess(res, await getHotelDetails(dto));
  }),
);

/** Step 4 — confirm selected room is still available. */
router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const dto = validateHotelRoomLookup(req.body);
    return sendSuccess(res, await revalidateHotelOffer(dto));
  }),
);

/** Step 5 — checkout page (guests → checkoutToken). */
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const dto = validateHotelCheckoutBody(req.body);
    return sendSuccess(res, await checkoutHotel(dto));
  }),
);

/** Step 6 — dummy payment + confirm booking. */
router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    const dto = validateHotelBookBody(req.body);
    return sendSuccess(res, await bookHotel(dto, req.user));
  }),
);

router.get(
  '/bookings',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await listHotelBookings(req.user._id));
  }),
);

router.post(
  '/bookings/details',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await getHotelBookingDetails(req.body || {}, req.user));
  }),
);

router.post(
  '/bookings/cancel',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await cancelHotelBooking(req.body || {}, req.user));
  }),
);

module.exports = router;
