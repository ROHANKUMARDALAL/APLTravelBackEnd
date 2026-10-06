'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const {
  getSiteConfig,
  listBlogs,
  getBlog,
  getPage,
} = require('../controllers/site.controller');

const router = express.Router();

/**
 * Public site delivery (Phase 8).
 * Tenant is resolved from Host / X-Forwarded-Host (dev: X-APL-Public-Host + host map).
 * Client-supplied dsaId is never trusted.
 */
router.get('/site/config', asyncHandler(getSiteConfig));
// Backward-compatible alias used during Phase 7 stub era.
router.get('/site', asyncHandler(getSiteConfig));

router.get('/blogs', asyncHandler(listBlogs));
router.get('/blogs/:slug', asyncHandler(getBlog));
router.get('/pages/:slug', asyncHandler(getPage));

module.exports = router;
