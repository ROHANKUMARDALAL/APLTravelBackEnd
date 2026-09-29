'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { requireLogin, optionalLogin } = require('../../common/middleware/require-login');
const {
  searchFlights,
  getFlightDetails,
  revalidateFlightOffer,
} = require('../services/flight-search.service');
const {
  checkoutFlight,
  bookFlight,
  listFlightBookings,
  getFlightBookingDetails,
  cancelFlightBooking,
} = require('../services/flight-booking.service');
const {
  validateAirportSearchBody,
  searchCityAirports,
} = require('../services/airport-search.service');
const {
  validateFlightSearchBody,
  parseFailureHeader,
  validateDetailsBody,
  validateFlightFareLookup,
  validateCheckoutBody,
  validateBookBody,
} = require('../validators/flight.validation');

const router = express.Router();

/**
 * Step 1 — search airports for a city (e.g. Delhi → DEL / HDO / DXN).
 * POST /api/v1/flights/airports/search
 */
router.post(
  '/airports/search',
  asyncHandler(async (req, res) => {
    const dto = validateAirportSearchBody(req.body);
    return sendSuccess(res, searchCityAirports(dto));
  }),
);

/**
 * Step 2 — search flights by metro city codes (expands to all city airports).
 * POST /api/v1/flights/search
 */
router.post(
  '/search',
  optionalLogin,
  asyncHandler(async (req, res) => {
    const dto = validateFlightSearchBody(req.body);
    const forced = parseFailureHeader(req.header('x-simulate-supplier-failure'));
    const result = await searchFlights(dto, forced.length > 0 ? forced : undefined, {
      requestId: req.requestId,
      userId: req.user?._id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const dto = validateDetailsBody(req.body);
    return sendSuccess(res, await getFlightDetails(dto));
  }),
);

router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const dto = validateFlightFareLookup(req.body);
    return sendSuccess(res, await revalidateFlightOffer(dto));
  }),
);

router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const dto = validateCheckoutBody(req.body);
    return sendSuccess(res, await checkoutFlight(dto));
  }),
);

router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    const dto = validateBookBody(req.body);
    return sendSuccess(res, await bookFlight(dto, req.user));
  }),
);

router.get(
  '/bookings',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await listFlightBookings(req.user._id));
  }),
);

router.post(
  '/bookings/details',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await getFlightBookingDetails(req.body || {}, req.user));
  }),
);

router.post(
  '/bookings/cancel',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await cancelFlightBooking(req.body || {}, req.user));
  }),
);

module.exports = router;
