'use strict';

const express = require('express');
const { sendSuccess } = require('../../common/response/envelope');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireDsaAdmin } = require('../middleware/require-dsa-admin');
const { requirePermission } = require('../../admin-auth/middleware/require-permission');
const { Permission } = require('../../admin-auth/permissions');
const authRoutes = require('./auth.routes');
const cmsRoutes = require('./cms.routes');
const {
  getDashboard,
  getProfile,
  patchProfile,
  listServices,
  patchService,
} = require('../controllers/portal.controller');
const pricingController = require('../controllers/pricing.controller');
const bookingsController = require('../controllers/bookings.controller');

const router = express.Router();

router.use('/auth', authRoutes);
router.use(cmsRoutes);

router.get(
  '/foundation',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      namespace: 'dsa-admin',
      phase: 6,
      status: 'dsa_admin_core_ready',
      message:
        'DSAAdmin core ready: tenant-self dashboard, profile, and service activation (isActiveByDSA only).',
    });
  }),
);

router.get(
  '/dashboard',
  requireDsaAdmin,
  requirePermission(Permission.SERVICE_VIEW),
  asyncHandler(getDashboard),
);

router.get('/profile', requireDsaAdmin, asyncHandler(getProfile));

router.patch(
  '/profile',
  requireDsaAdmin,
  requirePermission(Permission.SETTINGS_MANAGE),
  asyncHandler(patchProfile),
);

router.get(
  '/services',
  requireDsaAdmin,
  requirePermission(Permission.SERVICE_VIEW),
  asyncHandler(listServices),
);

router.patch(
  '/services/:serviceId',
  requireDsaAdmin,
  requirePermission(Permission.SERVICE_MANAGE),
  asyncHandler(patchService),
);

// Phase 12 — tenant-scoped DSA markup
router.get(
  '/pricing/rules',
  requireDsaAdmin,
  requirePermission(Permission.MARKUP_VIEW),
  asyncHandler(pricingController.list),
);
router.get(
  '/pricing/ceiling',
  requireDsaAdmin,
  requirePermission(Permission.MARKUP_VIEW),
  asyncHandler(pricingController.ceiling),
);
router.put(
  '/pricing/markup',
  requireDsaAdmin,
  requirePermission(Permission.MARKUP_MANAGE),
  asyncHandler(pricingController.upsertMarkup),
);
router.post(
  '/pricing/preview',
  requireDsaAdmin,
  requirePermission(Permission.MARKUP_VIEW),
  asyncHandler(pricingController.preview),
);

// Phase 13 — tenant-scoped bookings (Booking.dsaId === authenticated DSA)
router.get(
  '/bookings',
  requireDsaAdmin,
  requirePermission(Permission.BOOKING_VIEW),
  asyncHandler(bookingsController.listBookings),
);
router.get(
  '/bookings/:aplBookingRef',
  requireDsaAdmin,
  requirePermission(Permission.BOOKING_VIEW),
  asyncHandler(bookingsController.getBooking),
);

module.exports = router;
