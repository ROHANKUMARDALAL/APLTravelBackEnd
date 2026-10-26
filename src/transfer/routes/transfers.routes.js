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
    req.logService = 'TRANSFER';
    req.businessOperation = 'SEARCH';
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
    const publicResult = sanitizeTransferSearchForPublic(result);
    req.businessOperation = 'SEARCH';
    req.searchId = result.searchId;
    req.journeyId = result.searchId;
    await logPublicSearchResult({
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId,
      userId: req.user?._id,
      service: 'TRANSFER',
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
    req.logService = 'TRANSFER';
    req.businessOperation = 'DETAILS';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateTransferLookupBody(req.body);
    const details = await getTransferDetails(dto, { tenant: req.tenant });
    req.searchId = details.searchId || req.searchId;
    req.journeyId = details.searchId || req.journeyId;
    return sendSuccess(res, details);
  }),
);

router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    req.logService = 'TRANSFER';
    req.businessOperation = 'RECHECK';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateTransferLookupBody(req.body);
    const checked = await revalidateTransferOffer(dto, {
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
    req.logService = 'TRANSFER';
    req.businessOperation = 'CHECKOUT';
    req.searchId = req.body?.searchId;
    req.journeyId = req.body?.searchId;
    const dto = validateTransferCheckoutBody(req.body);
    const session = await checkoutTransfer(dto, {
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
    req.logService = 'TRANSFER';
    req.businessOperation = 'BOOK';
    req.searchId = req.body?.searchId;
    const dto = validateTransferBookBody(req.body);
    const booked = await bookTransfer(dto, req.user, {
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
