'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireDsaAdmin } = require('../middleware/require-dsa-admin');
const {
  requirePermission,
  requireAnyPermission,
} = require('../../admin-auth/middleware/require-permission');
const { Permission } = require('../../admin-auth/permissions');
const { singleImageUpload } = require('../../common/media/upload-middleware');
const cms = require('../controllers/cms.controller');

const router = express.Router();

router.get(
  '/website-settings',
  requireDsaAdmin,
  requirePermission(Permission.BRANDING_VIEW),
  asyncHandler(cms.getWebsiteSettingsHandler),
);
router.patch(
  '/website-settings',
  requireDsaAdmin,
  requirePermission(Permission.BRANDING_MANAGE),
  asyncHandler(cms.patchWebsiteSettingsHandler),
);

router.get(
  '/blogs',
  requireDsaAdmin,
  requirePermission(Permission.BLOG_VIEW),
  asyncHandler(cms.listBlogsHandler),
);
router.post(
  '/blogs',
  requireDsaAdmin,
  requirePermission(Permission.BLOG_CREATE),
  asyncHandler(cms.createBlogHandler),
);
router.get(
  '/blogs/:id',
  requireDsaAdmin,
  requirePermission(Permission.BLOG_VIEW),
  asyncHandler(cms.getBlogHandler),
);
router.patch(
  '/blogs/:id',
  requireDsaAdmin,
  requirePermission(Permission.BLOG_UPDATE),
  asyncHandler(cms.patchBlogHandler),
);
router.delete(
  '/blogs/:id',
  requireDsaAdmin,
  requirePermission(Permission.BLOG_DELETE),
  asyncHandler(cms.deleteBlogHandler),
);

router.get(
  '/testimonials',
  requireDsaAdmin,
  requirePermission(Permission.TESTIMONIAL_VIEW),
  asyncHandler(cms.listTestimonialsHandler),
);
router.post(
  '/testimonials',
  requireDsaAdmin,
  requirePermission(Permission.TESTIMONIAL_MANAGE),
  asyncHandler(cms.createTestimonialHandler),
);
router.patch(
  '/testimonials/:id',
  requireDsaAdmin,
  requirePermission(Permission.TESTIMONIAL_MANAGE),
  asyncHandler(cms.patchTestimonialHandler),
);
router.delete(
  '/testimonials/:id',
  requireDsaAdmin,
  requirePermission(Permission.TESTIMONIAL_MANAGE),
  asyncHandler(cms.deleteTestimonialHandler),
);

router.get(
  '/footer-links',
  requireDsaAdmin,
  requirePermission(Permission.FOOTER_VIEW),
  asyncHandler(cms.listFooterHandler),
);
router.post(
  '/footer-links',
  requireDsaAdmin,
  requirePermission(Permission.FOOTER_MANAGE),
  asyncHandler(cms.createFooterHandler),
);
router.patch(
  '/footer-links/:id',
  requireDsaAdmin,
  requirePermission(Permission.FOOTER_MANAGE),
  asyncHandler(cms.patchFooterHandler),
);
router.delete(
  '/footer-links/:id',
  requireDsaAdmin,
  requirePermission(Permission.FOOTER_MANAGE),
  asyncHandler(cms.deleteFooterHandler),
);

router.get(
  '/cms-pages',
  requireDsaAdmin,
  requirePermission(Permission.CMS_VIEW),
  asyncHandler(cms.listCmsPagesHandler),
);
router.post(
  '/cms-pages',
  requireDsaAdmin,
  requirePermission(Permission.CMS_MANAGE),
  asyncHandler(cms.createCmsPageHandler),
);
router.patch(
  '/cms-pages/:id',
  requireDsaAdmin,
  requirePermission(Permission.CMS_MANAGE),
  asyncHandler(cms.patchCmsPageHandler),
);
router.delete(
  '/cms-pages/:id',
  requireDsaAdmin,
  requirePermission(Permission.CMS_MANAGE),
  asyncHandler(cms.deleteCmsPageHandler),
);

router.get(
  '/banners',
  requireDsaAdmin,
  requirePermission(Permission.CMS_VIEW),
  asyncHandler(cms.listBannersHandler),
);
router.post(
  '/banners',
  requireDsaAdmin,
  requirePermission(Permission.CMS_MANAGE),
  asyncHandler(cms.createBannerHandler),
);
router.patch(
  '/banners/:id',
  requireDsaAdmin,
  requirePermission(Permission.CMS_MANAGE),
  asyncHandler(cms.patchBannerHandler),
);
router.delete(
  '/banners/:id',
  requireDsaAdmin,
  requirePermission(Permission.CMS_MANAGE),
  asyncHandler(cms.deleteBannerHandler),
);

router.post(
  '/media/upload',
  requireDsaAdmin,
  requireAnyPermission([
    Permission.BRANDING_MANAGE,
    Permission.BLOG_CREATE,
    Permission.BLOG_UPDATE,
    Permission.TESTIMONIAL_MANAGE,
    Permission.CMS_MANAGE,
  ]),
  singleImageUpload('file'),
  asyncHandler(cms.uploadMediaHandler),
);

module.exports = router;
