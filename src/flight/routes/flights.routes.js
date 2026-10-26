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
  searchFlights,
  getFlightDetails,
  revalidateFlightOffer,
  getFlightSsr,
  sanitizeFlightSearchForPublic,
} = require('../services/flight-search.service');
const { blockFlight } = require('../services/flight-block.service');
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

// Phase 9: trusted host → DSA; offer rule; ignore client dsaId.
router.use(requireTransactionTenant, requireOfferedService('flight'));

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

router.get(
  '/airports',
  asyncHandler(async (req, res) => {
    const dto = validateAirportSearchBody({
      query: req.query.query,
      cityCode: req.query.cityCode,
    });
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
      dsaId: req.tenant?.dsaId,
      tenant: req.tenant,
    });
    const publicResult = sanitizeFlightSearchForPublic(result);
    req.journeyId = result.journeyId;
    req.businessOperation = 'SEARCH';
    await logPublicSearchResult({
      requestId: req.requestId,
      journeyId: result.journeyId,
      businessOperation: 'SEARCH',
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      service: 'FLIGHT',
      searchId: result.searchId,
      payload: publicResult,
    });
    return sendSuccess(res, publicResult);
  }),
);

router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const dto = validateDetailsBody(req.body);
    return sendSuccess(res, await getFlightDetails(dto, { tenant: req.tenant }));
  }),
);

router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const dto = validateFlightFareLookup(req.body);
    const quoted = await revalidateFlightOffer(dto, {
      tenant: req.tenant,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      requestId: req.requestId,
      clientJourneyId: req.body?.journeyId || null,
      asReturn: req.body?.asReturn === true,
      simulatePriceChange: req.body?.simulatePriceChange === true,
      acceptPriceChange: req.body?.acceptPriceChange === true,
      expired: req.body?.expired === true,
      supplier: req.body?.supplier || null,
    });
    req.journeyId = quoted.journeyId;
    req.businessOperation = 'CONFIRM_FARE';
    return sendSuccess(res, quoted);
  }),
);

router.post(
  '/fare-quote',
  asyncHandler(async (req, res) => {
    const dto = validateFlightFareLookup(req.body);
    const quoted = await revalidateFlightOffer(dto, {
      tenant: req.tenant,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      requestId: req.requestId,
      clientJourneyId: req.body?.journeyId || null,
      asReturn: req.body?.asReturn === true,
      simulatePriceChange: req.body?.simulatePriceChange === true,
      acceptPriceChange: req.body?.acceptPriceChange === true,
      expired: req.body?.expired === true,
      supplier: req.body?.supplier || null,
    });
    req.journeyId = quoted.journeyId;
    req.businessOperation = 'CONFIRM_FARE';
    return sendSuccess(res, quoted);
  }),
);

router.post(
  '/ssr',
  asyncHandler(async (req, res) => {
    const dto = validateDetailsBody(req.body);
    const inventory = await getFlightSsr(dto, {
      tenant: req.tenant,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      requestId: req.requestId,
      clientJourneyId: req.body?.journeyId || null,
      asReturn: req.body?.asReturn === true,
      supplier: req.body?.supplier || null,
    });
    req.journeyId = inventory.journeyId;
    req.businessOperation = 'SSR';
    return sendSuccess(res, inventory);
  }),
);

router.post(
  '/block',
  requireLogin,
  asyncHandler(async (req, res) => {
    const blocked = await blockFlight(req.body || {}, {
      tenant: req.tenant,
      userId: req.user?._id,
      requestId: req.requestId,
      simulatePriceChange: req.body?.simulatePriceChange === true,
      acceptPriceChange: req.body?.acceptPriceChange === true,
      simulateBlockFailure: req.body?.simulateBlockFailure === true,
    });
    req.journeyId = blocked.journeyId;
    req.businessOperation = 'BLOCK';
    return sendSuccess(res, blocked);
  }),
);

router.post(
  '/checkout',
  optionalLogin,
  asyncHandler(async (req, res) => {
    const dto = validateCheckoutBody(req.body);
    return sendSuccess(
      res,
      await checkoutFlight(dto, {
        tenant: req.tenant,
        requestId: req.requestId,
        userId: req.user?._id || null,
        couponCode: req.body?.couponCode,
      }),
    );
  }),
);

router.post(
  '/book',
  requireLogin,
  asyncHandler(async (req, res) => {
    const dto = validateBookBody(req.body);
    return sendSuccess(
      res,
      await bookFlight(dto, req.user, {
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
      await listFlightBookings(req.user._id, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/bookings/details',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await getFlightBookingDetails(req.body || {}, req.user, { tenant: req.tenant }),
    );
  }),
);

router.post(
  '/bookings/cancel',
  requireLogin,
  asyncHandler(async (req, res) => {
    return sendSuccess(
      res,
      await cancelFlightBooking(req.body || {}, req.user, {
        tenant: req.tenant,
        requestId: req.requestId,
      }),
    );
  }),
);

module.exports = router;
