'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const { AppError } = require('../../common/errors/app-error');
const { resolvePublicTenant } = require('../services/resolve-tenant.service');
const {
  buildPublicSiteConfig,
  listPublicBlogs,
  getPublicBlogBySlug,
  getPublicPageBySlug,
} = require('../../cms/services/public-site-config.service');
const {
  SUPPORTED_ROUTE_SERVICES,
  groupPublicPopularRoutes,
} = require('../services/popular-routes.service');

async function getSiteConfig(req, res) {
  const { dsa, host, source } = await resolvePublicTenant(req);
  const configPayload = await buildPublicSiteConfig(dsa);
  res.set('Cache-Control', 'private, no-store');
  return sendSuccess(res, {
    ...configPayload,
    meta: {
      resolvedHost: host,
      resolutionSource: source,
    },
  });
}

async function listBlogs(req, res) {
  res.set('Cache-Control', 'private, no-store');
  const { dsa } = await resolvePublicTenant(req);
  const data = await listPublicBlogs(dsa._id, {
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  return sendSuccess(res, data);
}

async function getBlog(req, res) {
  res.set('Cache-Control', 'private, no-store');
  const { dsa } = await resolvePublicTenant(req);
  const blog = await getPublicBlogBySlug(dsa._id, req.params.slug);
  if (!blog) throw AppError.notFound('Blog not found');
  return sendSuccess(res, { blog });
}

async function listPopularRoutes(req, res) {
  const { dsa } = await resolvePublicTenant(req);
  const configPayload = await buildPublicSiteConfig(dsa);
  const offered = configPayload.services || [];
  const offeredCodes = offered
    .map((service) => String(service.code || '').toLowerCase())
    .filter((code) => SUPPORTED_ROUTE_SERVICES.has(code));
  res.set('Cache-Control', 'no-store');
  if (!offeredCodes.length) return sendSuccess(res, { groups: [], routes: [] });

  const PopularRoute = require('../models/PopularRoute');
  const rows = await PopularRoute.find({
    dsaId: dsa._id,
    serviceCode: { $in: offeredCodes },
    isActive: true,
    isFeatured: true,
  })
    .sort({ priority: 1, updatedAt: -1 })
    .lean();
  const groups = groupPublicPopularRoutes(offered, rows);
  const routes = groups.find((group) => group.serviceCode === 'flight')?.routes || [];
  return sendSuccess(res, { groups, routes });
}

async function getPage(req, res) {
  const { dsa } = await resolvePublicTenant(req);
  const page = await getPublicPageBySlug(dsa._id, req.params.slug);
  if (!page) throw AppError.notFound('Page not found');
  return sendSuccess(res, { page });
}

module.exports = {
  getSiteConfig,
  listBlogs,
  getBlog,
  getPage,
  listPopularRoutes,
};
