'use strict';

const express = require('express');
const { sendSuccess } = require('../../common/response/envelope');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireAplAdmin } = require('../middleware/require-apl-admin');
const { requirePermission } = require('../../admin-auth/middleware/require-permission');
const { Permission } = require('../../admin-auth/permissions');
const authRoutes = require('./auth.routes');
const {
  listServices,
  getService,
  createService,
  updateService,
  evaluateOffer,
} = require('../controllers/services.controller');
const {
  listDsas,
  getDsa,
  create,
  update,
  changeStatus,
  listDsaServices,
  patchDsaService,
  listAdmins,
  provisionAdmin,
} = require('../controllers/dsas.controller');
const { getDashboard } = require('../controllers/dashboard.controller');
const suppliersController = require('../controllers/suppliers.controller');
const pricingController = require('../controllers/pricing.controller');
const bookingsController = require('../controllers/bookings.controller');

const router = express.Router();

router.use('/auth', authRoutes);

router.get(
  '/foundation',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      namespace: 'apl-admin',
      phase: 5,
      status: 'apl_admin_core_ready',
      message:
        'APLAdmin core APIs ready: dashboard, DSA CRUD/status, master services, DSA service assignment.',
    });
  }),
);

router.get(
  '/dashboard',
  requireAplAdmin,
  requirePermission(Permission.DSA_VIEW),
  asyncHandler(getDashboard),
);

router.get(
  '/dsas',
  requireAplAdmin,
  requirePermission(Permission.DSA_VIEW),
  asyncHandler(listDsas),
);
router.post(
  '/dsas',
  requireAplAdmin,
  requirePermission(Permission.DSA_CREATE),
  asyncHandler(create),
);
router.get(
  '/dsas/:id',
  requireAplAdmin,
  requirePermission(Permission.DSA_VIEW),
  asyncHandler(getDsa),
);
router.patch(
  '/dsas/:id',
  requireAplAdmin,
  requirePermission(Permission.DSA_UPDATE),
  asyncHandler(update),
);
router.patch(
  '/dsas/:id/status',
  requireAplAdmin,
  requirePermission(Permission.DSA_SUSPEND),
  asyncHandler(changeStatus),
);
router.get(
  '/dsas/:id/services',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_VIEW),
  asyncHandler(listDsaServices),
);
router.patch(
  '/dsas/:id/services/:serviceId',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_ASSIGN),
  asyncHandler(patchDsaService),
);

router.get(
  '/dsas/:id/admins',
  requireAplAdmin,
  requirePermission(Permission.USER_VIEW),
  asyncHandler(listAdmins),
);
router.post(
  '/dsas/:id/admins',
  requireAplAdmin,
  requirePermission(Permission.USER_MANAGE),
  asyncHandler(provisionAdmin),
);

router.get(
  '/services',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_VIEW),
  asyncHandler(listServices),
);
router.post(
  '/services',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_MANAGE),
  asyncHandler(createService),
);
router.get(
  '/services/:id',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_VIEW),
  asyncHandler(getService),
);
router.patch(
  '/services/:id',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_MANAGE),
  asyncHandler(updateService),
);

router.get(
  '/service-offer/evaluate',
  requireAplAdmin,
  requirePermission(Permission.SERVICE_VIEW),
  asyncHandler(evaluateOffer),
);

// Phase 10 — Supplier platform
router.get(
  '/suppliers',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_VIEW),
  asyncHandler(suppliersController.list),
);
router.post(
  '/suppliers',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_MANAGE),
  asyncHandler(suppliersController.create),
);
router.get(
  '/suppliers/:id',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_VIEW),
  asyncHandler(suppliersController.get),
);
router.patch(
  '/suppliers/:id',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_MANAGE),
  asyncHandler(suppliersController.update),
);
router.put(
  '/suppliers/:id/services',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_MANAGE),
  asyncHandler(suppliersController.upsertServiceMapping),
);

router.get(
  '/supplier-assignments',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_VIEW),
  asyncHandler(suppliersController.listAssignments),
);
router.put(
  '/supplier-assignments',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_ASSIGN),
  asyncHandler(suppliersController.upsertAssignment),
);
router.delete(
  '/supplier-assignments/:id',
  requireAplAdmin,
  requirePermission(Permission.SUPPLIER_ASSIGN),
  asyncHandler(suppliersController.removeAssignment),
);

router.get(
  '/request-logs',
  requireAplAdmin,
  requirePermission(Permission.REQUESTLOG_VIEW),
  asyncHandler(suppliersController.listRequestLogs),
);
router.get(
  '/request-logs/:requestId',
  requireAplAdmin,
  requirePermission(Permission.REQUESTLOG_VIEW),
  asyncHandler(suppliersController.getRequestLogDetail),
);

// Phase 12 — Pricing / commercial rules
router.get(
  '/pricing/rules',
  requireAplAdmin,
  requirePermission(Permission.PRICING_VIEW),
  asyncHandler(pricingController.list),
);
router.get(
  '/pricing/rules/:id',
  requireAplAdmin,
  requirePermission(Permission.PRICING_VIEW),
  asyncHandler(pricingController.get),
);
router.post(
  '/pricing/rules',
  requireAplAdmin,
  requirePermission(Permission.PRICING_MANAGE),
  asyncHandler(pricingController.create),
);
router.patch(
  '/pricing/rules/:id',
  requireAplAdmin,
  requirePermission(Permission.PRICING_MANAGE),
  asyncHandler(pricingController.update),
);
router.post(
  '/pricing/preview',
  requireAplAdmin,
  requirePermission(Permission.PRICING_VIEW),
  asyncHandler(pricingController.preview),
);

// Phase 13 — Bookings / Payments / Refunds ops
router.get(
  '/bookings',
  requireAplAdmin,
  requirePermission(Permission.BOOKING_VIEW),
  asyncHandler(bookingsController.listBookings),
);
router.get(
  '/bookings/:aplBookingRef',
  requireAplAdmin,
  requirePermission(Permission.BOOKING_VIEW),
  asyncHandler(bookingsController.getBooking),
);
router.get(
  '/payments',
  requireAplAdmin,
  requirePermission(Permission.PAYMENT_VIEW),
  asyncHandler(bookingsController.listPayments),
);
router.get(
  '/refunds',
  requireAplAdmin,
  requirePermission(Permission.REFUND_VIEW),
  asyncHandler(bookingsController.listRefunds),
);

module.exports = router;
