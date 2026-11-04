'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../common/middleware/error-handler');
const { sendSuccess } = require('../common/response/envelope');
const { AppError } = require('../common/errors/app-error');
const { createSupportRequest, listForCustomer } = require('./support-request.service');
const { createCustomerReview, updateCustomerReview, deleteCustomerReview, listCustomerReviews } = require('../cms/services/testimonial.service');

const router = express.Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { ErrorMessage: 'Too many requests. Please wait and try again.' } },
});

function tenantId(req) {
  if (!req.customerDsaId) throw AppError.forbidden('This website is not available');
  return req.customerDsaId;
}

router.get('/support-requests', asyncHandler(async (req, res) => {
  const requests = await listForCustomer(tenantId(req), req.user._id);
  return sendSuccess(res, { requests });
}));

router.post('/support-requests', writeLimiter, asyncHandler(async (req, res) => {
  const result = await createSupportRequest({
    dsaId: tenantId(req),
    user: req.user,
    input: req.body || {},
    idempotencyKey: req.get('idempotency-key') || '',
  });
  return sendSuccess(res, result);
}));

router.get('/reviews', asyncHandler(async (req, res) => {
  const reviews = await listCustomerReviews(tenantId(req), req.user._id);
  return sendSuccess(res, { reviews });
}));

router.post('/reviews', writeLimiter, asyncHandler(async (req, res) => {
  const review = await createCustomerReview({
    dsaId: tenantId(req),
    user: req.user,
    input: req.body || {},
  });
  return sendSuccess(res, { review });
}));

router.patch('/reviews/:id', writeLimiter, asyncHandler(async (req, res) => {
  const review = await updateCustomerReview({
    dsaId: tenantId(req),
    user: req.user,
    reviewId: req.params.id,
    input: req.body || {},
  });
  return sendSuccess(res, { review });
}));

router.delete('/reviews/:id', writeLimiter, asyncHandler(async (req, res) => {
  const result = await deleteCustomerReview({
    dsaId: tenantId(req),
    user: req.user,
    reviewId: req.params.id,
  });
  return sendSuccess(res, result);
}));

module.exports = router;
