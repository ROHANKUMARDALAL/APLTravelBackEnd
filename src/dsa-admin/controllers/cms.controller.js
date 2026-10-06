'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const { resolveTenantDsaId } = require('../../tenant/middleware/tenant-context');
const { logAdminAction } = require('../../apl-admin/services/admin-action-log');
const { storeDsaImage } = require('../../common/media/storage');
const {
  getWebsiteSettings,
  updateWebsiteSettings,
} = require('../../cms/services/website-settings.service');
const {
  listBlogs,
  getBlogForTenant,
  createBlog,
  updateBlog,
  deleteBlog,
  toPublic: blogToPublic,
} = require('../../cms/services/blog.service');
const {
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
} = require('../../cms/services/testimonial.service');
const {
  listFooterLinks,
  createFooterLink,
  updateFooterLink,
  deleteFooterLink,
} = require('../../cms/services/footer.service');
const {
  listCmsPages,
  createCmsPage,
  updateCmsPage,
  deleteCmsPage,
} = require('../../cms/services/cms-page.service');
const {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
} = require('../../cms/services/banner.service');

function stripClientTenant(body = {}) {
  const next = { ...body };
  delete next.dsaId;
  delete next.id;
  return next;
}

function actorFrom(req) {
  return {
    id: req.admin?.id,
    email: req.admin?.public?.email || req.admin?.user?.email,
    type: 'DSA',
  };
}

async function getWebsiteSettingsHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const settings = await getWebsiteSettings(dsaId);
  return sendSuccess(res, { settings });
}

async function patchWebsiteSettingsHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const settings = await updateWebsiteSettings(dsaId, stripClientTenant(req.body));
  logAdminAction({
    actor: actorFrom(req),
    action: 'website_settings.update',
    resourceType: 'WebsiteSettings',
    resourceId: settings.id,
    details: {
      websiteName: settings.websiteName,
      hasLogo: Boolean(settings.logoUrl),
    },
  });
  return sendSuccess(res, { settings });
}

async function listBlogsHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const data = await listBlogs(dsaId, {
    q: req.query.q,
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  return sendSuccess(res, data);
}

async function getBlogHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const blog = await getBlogForTenant(dsaId, req.params.id);
  return sendSuccess(res, { blog: blogToPublic(blog) });
}

async function createBlogHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const blog = await createBlog(dsaId, stripClientTenant(req.body));
  logAdminAction({
    actor: actorFrom(req),
    action: 'blog.create',
    resourceType: 'Blog',
    resourceId: blog.id,
    details: { slug: blog.slug, status: blog.status },
  });
  return sendSuccess(res, { blog });
}

async function patchBlogHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const before = await getBlogForTenant(dsaId, req.params.id);
  const prevStatus = before.status;
  const blog = await updateBlog(dsaId, req.params.id, stripClientTenant(req.body));
  let action = 'blog.update';
  if (prevStatus !== blog.status && blog.status === 'PUBLISHED') action = 'blog.publish';
  if (prevStatus !== blog.status && prevStatus === 'PUBLISHED') action = 'blog.unpublish';
  logAdminAction({
    actor: actorFrom(req),
    action,
    resourceType: 'Blog',
    resourceId: blog.id,
    details: { slug: blog.slug, status: blog.status },
  });
  return sendSuccess(res, { blog });
}

async function deleteBlogHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const result = await deleteBlog(dsaId, req.params.id);
  logAdminAction({
    actor: actorFrom(req),
    action: 'blog.delete',
    resourceType: 'Blog',
    resourceId: result.id,
    details: {},
  });
  return sendSuccess(res, result);
}

async function listTestimonialsHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const items = await listTestimonials(dsaId, { status: req.query.status });
  return sendSuccess(res, { items });
}

async function createTestimonialHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await createTestimonial(dsaId, stripClientTenant(req.body));
  logAdminAction({
    actor: actorFrom(req),
    action: 'testimonial.create',
    resourceType: 'Testimonial',
    resourceId: item.id,
    details: { status: item.status, rating: item.rating },
  });
  return sendSuccess(res, { item });
}

async function patchTestimonialHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await updateTestimonial(
    dsaId,
    req.params.id,
    stripClientTenant(req.body),
  );
  logAdminAction({
    actor: actorFrom(req),
    action:
      item.status === 'ACTIVE'
        ? 'testimonial.activate'
        : 'testimonial.update',
    resourceType: 'Testimonial',
    resourceId: item.id,
    details: { status: item.status },
  });
  return sendSuccess(res, { item });
}

async function deleteTestimonialHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const result = await deleteTestimonial(dsaId, req.params.id);
  logAdminAction({
    actor: actorFrom(req),
    action: 'testimonial.delete',
    resourceType: 'Testimonial',
    resourceId: result.id,
    details: {},
  });
  return sendSuccess(res, result);
}

async function listFooterHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const items = await listFooterLinks(dsaId, { status: req.query.status });
  return sendSuccess(res, { items });
}

async function createFooterHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await createFooterLink(dsaId, stripClientTenant(req.body));
  logAdminAction({
    actor: actorFrom(req),
    action: 'footer_link.create',
    resourceType: 'FooterLink',
    resourceId: item.id,
    details: { group: item.group, status: item.status },
  });
  return sendSuccess(res, { item });
}

async function patchFooterHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await updateFooterLink(
    dsaId,
    req.params.id,
    stripClientTenant(req.body),
  );
  logAdminAction({
    actor: actorFrom(req),
    action: 'footer_link.update',
    resourceType: 'FooterLink',
    resourceId: item.id,
    details: { group: item.group, displayOrder: item.displayOrder },
  });
  return sendSuccess(res, { item });
}

async function deleteFooterHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const result = await deleteFooterLink(dsaId, req.params.id);
  logAdminAction({
    actor: actorFrom(req),
    action: 'footer_link.delete',
    resourceType: 'FooterLink',
    resourceId: result.id,
    details: {},
  });
  return sendSuccess(res, result);
}

async function listCmsPagesHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const items = await listCmsPages(dsaId, {
    status: req.query.status,
    pageType: req.query.pageType,
  });
  return sendSuccess(res, { items });
}

async function createCmsPageHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await createCmsPage(dsaId, stripClientTenant(req.body));
  logAdminAction({
    actor: actorFrom(req),
    action: 'cms_page.create',
    resourceType: 'CmsPage',
    resourceId: item.id,
    details: { slug: item.slug, pageType: item.pageType, status: item.status },
  });
  return sendSuccess(res, { item });
}

async function patchCmsPageHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await updateCmsPage(
    dsaId,
    req.params.id,
    stripClientTenant(req.body),
  );
  logAdminAction({
    actor: actorFrom(req),
    action: 'cms_page.update',
    resourceType: 'CmsPage',
    resourceId: item.id,
    details: { slug: item.slug, status: item.status },
  });
  return sendSuccess(res, { item });
}

async function deleteCmsPageHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const result = await deleteCmsPage(dsaId, req.params.id);
  logAdminAction({
    actor: actorFrom(req),
    action: 'cms_page.delete',
    resourceType: 'CmsPage',
    resourceId: result.id,
    details: {},
  });
  return sendSuccess(res, result);
}

async function listBannersHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const items = await listBanners(dsaId, {
    status: req.query.status,
    placement: req.query.placement,
  });
  return sendSuccess(res, { items });
}

async function createBannerHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await createBanner(dsaId, stripClientTenant(req.body));
  logAdminAction({
    actor: actorFrom(req),
    action: 'banner.create',
    resourceType: 'Banner',
    resourceId: item.id,
    details: { placement: item.placement, status: item.status },
  });
  return sendSuccess(res, { item });
}

async function patchBannerHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const item = await updateBanner(
    dsaId,
    req.params.id,
    stripClientTenant(req.body),
  );
  logAdminAction({
    actor: actorFrom(req),
    action: 'banner.update',
    resourceType: 'Banner',
    resourceId: item.id,
    details: { placement: item.placement, status: item.status },
  });
  return sendSuccess(res, { item });
}

async function deleteBannerHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const result = await deleteBanner(dsaId, req.params.id);
  logAdminAction({
    actor: actorFrom(req),
    action: 'banner.delete',
    resourceType: 'Banner',
    resourceId: result.id,
    details: {},
  });
  return sendSuccess(res, result);
}

async function uploadMediaHandler(req, res) {
  const dsaId = resolveTenantDsaId(req);
  const purpose = String(req.body?.purpose || req.query.purpose || '').trim();
  const stored = await storeDsaImage({
    dsaId,
    purpose,
    file: req.file,
  });
  logAdminAction({
    actor: actorFrom(req),
    action: 'media.upload',
    resourceType: 'Media',
    resourceId: stored.relativePath,
    details: { purpose: stored.purpose, url: stored.url },
  });
  return sendSuccess(res, { media: stored });
}

module.exports = {
  getWebsiteSettingsHandler,
  patchWebsiteSettingsHandler,
  listBlogsHandler,
  getBlogHandler,
  createBlogHandler,
  patchBlogHandler,
  deleteBlogHandler,
  listTestimonialsHandler,
  createTestimonialHandler,
  patchTestimonialHandler,
  deleteTestimonialHandler,
  listFooterHandler,
  createFooterHandler,
  patchFooterHandler,
  deleteFooterHandler,
  listCmsPagesHandler,
  createCmsPageHandler,
  patchCmsPageHandler,
  deleteCmsPageHandler,
  listBannersHandler,
  createBannerHandler,
  patchBannerHandler,
  deleteBannerHandler,
  uploadMediaHandler,
};
