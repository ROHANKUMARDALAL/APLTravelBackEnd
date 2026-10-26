'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { AppError } = require('../../common/errors/app-error');
const { requireLogin } = require('../../common/middleware/require-login');
const {
  requireTransactionTenant,
  requireOfferedService,
} = require('../../tenant/middleware/require-transaction-tenant');
const { holidayPackages, enquiries, DomainError } = require('@apl/shared-domain');
const { HolidayPackage } = require('@apl/shared-domain/models');

const router = express.Router();

function fail(error) {
  if (error instanceof DomainError || error?.name === 'DomainError') {
    if (error.httpStatus === 404) throw AppError.notFound(error.message);
    if (error.httpStatus === 403) throw AppError.forbidden(error.message);
    if (error.httpStatus === 401) throw AppError.unauthorized(error.message);
    throw AppError.validation(error.message, error.details || []);
  }
  throw error;
}

router.get(
  '/',
  requireTransactionTenant,
  requireOfferedService('holiday'),
  asyncHandler(async (req, res) => {
    try {
      const packages = await holidayPackages.listPublicHolidayPackages(req.tenant.dsaId, req.query || {});
      return sendSuccess(res, { packages });
    } catch (error) {
      fail(error);
    }
  }),
);

router.get(
  '/destinations',
  requireTransactionTenant,
  requireOfferedService('holiday'),
  asyncHandler(async (req, res) => {
    try {
      const destinations = await holidayPackages.listPublicHolidayDestinations(
        req.tenant.dsaId,
        req.query || {},
      );
      return sendSuccess(res, { destinations });
    } catch (error) {
      fail(error);
    }
  }),
);

router.get(
  '/:slug',
  requireTransactionTenant,
  requireOfferedService('holiday'),
  asyncHandler(async (req, res) => {
    req.logService = 'HOLIDAY';
    req.businessOperation = 'DETAILS';
    req.journeyId = `holiday:${String(req.params.slug || '').toLowerCase()}`;
    try {
      const holidayPackage = await holidayPackages.getPublicHolidayPackage(
        req.tenant.dsaId,
        req.params.slug,
      );
      return sendSuccess(res, { package: holidayPackage });
    } catch (error) {
      fail(error);
    }
  }),
);

router.post(
  '/:slug/enquiries',
  requireTransactionTenant,
  requireOfferedService('holiday'),
  requireLogin,
  asyncHandler(async (req, res) => {
    if (!req.customerDsaId || String(req.customerDsaId) !== String(req.tenant.dsaId)) {
      throw AppError.forbidden('Your account is not registered on this website');
    }
    const packageDoc = await HolidayPackage.findOne({
      dsaId: req.tenant.dsaId,
      slug: String(req.params.slug || '').toLowerCase(),
    });
    if (!packageDoc) throw AppError.notFound('Holiday package not found');
    const body = { ...(req.body || {}) };
    delete body.dsaId;
    delete body.customerId;
    delete body.isInternational;
    delete body.startingPrice;
    delete body.price;
    req.logService = 'HOLIDAY';
    req.businessOperation = 'ENQUIRY';
    try {
      const result = await enquiries.submitEnquiry({
        dsaId: req.tenant.dsaId,
        serviceCode: 'holiday',
        customer: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          phone: req.user.phoneNumber,
        },
        membership: {
          id: req.customerMembership._id,
          customerCode: req.customerMembership.customerCode,
        },
        packageDoc,
        body,
      });
      req.journeyId = result.enquiry.enquiryReference;
      return sendSuccess(res, {
        enquiryReference: result.enquiry.enquiryReference,
        status: result.enquiry.status,
        created: result.created,
      });
    } catch (error) {
      fail(error);
    }
  }),
);

module.exports = router;
