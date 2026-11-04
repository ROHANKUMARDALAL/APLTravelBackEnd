'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { AppError } = require('../../common/errors/app-error');
const { requireLogin } = require('../../common/middleware/require-login');
const { requireTransactionTenant } = require('../../tenant/middleware/require-transaction-tenant');
const { assertServiceOfferedForTenant } = require('../../tenant/services/transaction-tenant.service');
const rateLimit = require('express-rate-limit');
const Dsa = require('../../tenant/models/Dsa');
const { enquiries, DomainError, canonicalServiceCode } = require('@apl/shared-domain');

const router = express.Router();
const ENQUIRY_SERVICES = new Set(['visa', 'recharge', 'insurance', 'transfer']);

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
  '/mine',
  requireTransactionTenant,
  requireLogin,
  asyncHandler(async (req, res) => {
    if (!req.customerDsaId || String(req.customerDsaId) !== String(req.tenant.dsaId)) {
      throw AppError.forbidden('Your account is not registered on this website');
    }
    const items = await enquiries.listCustomerEnquiries({
      dsaId: req.tenant.dsaId,
      customerId: req.user._id,
    });
    return sendSuccess(res, { enquiries: items });
  }),
);

const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/',
  enquiryLimiter,
  requireTransactionTenant,
  requireLogin,
  asyncHandler(async (req, res) => {
    if (!req.customerDsaId || String(req.customerDsaId) !== String(req.tenant.dsaId)) {
      throw AppError.forbidden('Your account is not registered on this website');
    }
    const serviceCode = canonicalServiceCode(req.body?.serviceCode);
    req.logService = String(serviceCode || 'ENQUIRY').toUpperCase();
    req.businessOperation = 'ENQUIRY';
    if (serviceCode === 'holiday') {
      throw AppError.validation('Submit a holiday enquiry from the holiday package page');
    }
    if (!ENQUIRY_SERVICES.has(serviceCode)) {
      throw AppError.validation('This service does not accept enquiries here');
    }
    await assertServiceOfferedForTenant(req.tenant.dsaId, serviceCode);
    const body = { ...(req.body || {}) };
    delete body.dsaId;
    delete body.customerId;
    delete body.isInternational;
    const desk = await Dsa.findById(req.tenant.dsaId).select('dsaCode displayName companyName').lean();
    try {
      const result = await enquiries.submitEnquiry({
        dsaId: req.tenant.dsaId,
        dsaSnapshot: {
          dsaCode: desk?.dsaCode || req.tenant.dsaCode || '',
          dsaName: desk?.displayName || desk?.companyName || '',
        },
        serviceCode,
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
        body,
      });
      req.journeyId = result.enquiry.enquiryReference;
      return sendSuccess(res, {
        enquiryReference: result.enquiry.enquiryReference,
        status: result.enquiry.status,
        created: result.created,
        serviceCode,
      });
    } catch (error) {
      fail(error);
    }
  }),
);

module.exports = router;
