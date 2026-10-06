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

async function getSiteConfig(req, res) {
  const { dsa, host, source } = await resolvePublicTenant(req);
  const configPayload = await buildPublicSiteConfig(dsa);
  return sendSuccess(res, {
    ...configPayload,
    meta: {
      resolvedHost: host,
      resolutionSource: source,
    },
  });
}

async function listBlogs(req, res) {
  const { dsa } = await resolvePublicTenant(req);
  const data = await listPublicBlogs(dsa._id, {
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  return sendSuccess(res, data);
}

async function getBlog(req, res) {
  const { dsa } = await resolvePublicTenant(req);
  const blog = await getPublicBlogBySlug(dsa._id, req.params.slug);
  if (!blog) throw AppError.notFound('Blog not found');
  return sendSuccess(res, { blog });
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
};
