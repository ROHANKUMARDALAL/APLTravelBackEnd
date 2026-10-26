'use strict';

/**
 * Public-safe tenant website configuration for B2C.
 * Never includes admin users, permissions, secrets, or draft content.
 */

const { getWebsiteSettings } = require('./website-settings.service');
const Blog = require('../models/Blog');
const Testimonial = require('../models/Testimonial');
const FooterLink = require('../models/FooterLink');
const CmsPage = require('../models/CmsPage');
const Banner = require('../models/Banner');
const User = require('../../user/models/User');
const DsaCustomerMembership = require('../../customer/models/DsaCustomerMembership');
const {
  listOfferedServicesForDsa,
} = require('../../tenant/services/service-offer.service');

function publicBlogImages(blog) {
  const stored = Array.isArray(blog.images) ? blog.images.filter((row) => row && row.url) : [];
  const images = stored.length
    ? stored
    : (blog.featuredImageUrl ? [{ url: blog.featuredImageUrl, alt: '', caption: '', cover: true }] : []);
  return images.map((row) => ({
    url: row.url,
    alt: row.alt || '',
    caption: row.caption || '',
    cover: Boolean(row.cover),
  }));
}

function publicBlogCard(blog) {
  const images = publicBlogImages(blog);
  const cover = images.find((row) => row.cover) || images[0];
  return {
    title: blog.title,
    slug: blog.slug,
    shortDescription: blog.shortDescription || '',
    featuredImageUrl: cover?.url || blog.featuredImageUrl || '',
    images,
    publishDate: blog.publishDate,
    seoTitle: blog.seoTitle || '',
    seoDescription: blog.seoDescription || '',
  };
}

function publicBranding(settings) {
  return {
    websiteName: settings?.websiteName || '',
    tagline: settings?.tagline || '',
    logoUrl: settings?.logoUrl || '',
    faviconUrl: settings?.faviconUrl || '',
    primaryColor: settings?.primaryColor || '',
  };
}

async function publicTestimonials(dsaId, rows) {
  const ids = rows.map((row) => row.customerId).filter(Boolean);
  const memberships = ids.length
    ? await DsaCustomerMembership.find({
      dsaId,
      userId: { $in: ids },
      status: { $ne: 'REMOVED' },
    }).select('userId').lean()
    : [];
  const allowed = memberships.map((row) => row.userId);
  const users = allowed.length
    ? await User.find({ _id: { $in: allowed } }).select('name profilePhoto').lean()
    : [];
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return rows.map((row) => {
    const customer = row.customerId ? byId.get(String(row.customerId)) : null;
    return {
      customerName: customer?.name || row.customerName,
      message: row.message,
      rating: row.rating,
      imageUrl: customer ? (customer.profilePhoto || '') : (row.imageUrl || ''),
      displayOrder: row.displayOrder,
    };
  });
}

async function buildPublicSiteConfig(dsa) {
  const dsaId = dsa._id || dsa.id;
  const [settings, blogs, testimonials, footerLinks, pages, banners, services] =
    await Promise.all([
      getWebsiteSettings(dsaId),
      Blog.find({ dsaId, status: 'PUBLISHED' })
        .sort({ publishDate: -1 })
        .limit(20)
        .select(
          'title slug shortDescription featuredImageUrl images publishDate seoTitle seoDescription',
        )
        .lean(),
      Testimonial.find({ dsaId, status: 'ACTIVE' })
        .sort({ displayOrder: 1 })
        .lean(),
      FooterLink.find({ dsaId, status: 'ACTIVE' })
        .sort({ group: 1, displayOrder: 1 })
        .lean(),
      CmsPage.find({ dsaId, status: 'PUBLISHED' })
        .select('title slug pageType seoTitle seoDescription updatedAt')
        .lean(),
      Banner.find({ dsaId, status: 'ACTIVE' })
        .sort({ placement: 1, displayOrder: 1 })
        .lean(),
      // Fail closed: if offer evaluation fails, expose no services.
      listOfferedServicesForDsa(dsaId).catch(() => []),
    ]);

  return {
    tenant: {
      code: dsa.dsaCode,
      displayName: dsa.displayName,
      companyName: dsa.companyName,
    },
    branding: {
      ...publicBranding(settings),
      websiteName:
        settings?.websiteName || dsa.displayName || dsa.companyName || '',
    },
    contact: {
      email: settings?.contact?.email || '',
      phone: settings?.contact?.phone || '',
      alternatePhone: settings?.contact?.alternatePhone || '',
      address: settings?.contact?.address || '',
    },
    social: {
      facebook: settings?.social?.facebook || '',
      instagram: settings?.social?.instagram || '',
      linkedin: settings?.social?.linkedin || '',
      twitter: settings?.social?.twitter || '',
      youtube: settings?.social?.youtube || '',
    },
    seo: {
      defaultTitle: settings?.seo?.defaultTitle || '',
      defaultDescription: settings?.seo?.defaultDescription || '',
      keywords: settings?.seo?.keywords || '',
    },
    services: (services || []).map((s) => ({
      code: s.code,
      name: s.name,
      slug: s.slug,
      icon: s.icon || s.code,
      displayOrder: s.displayOrder,
      serviceMode: s.serviceMode || '',
    })),
    footer: footerLinks.map((f) => ({
      title: f.title,
      url: f.url,
      group: f.group,
      displayOrder: f.displayOrder,
    })),
    testimonials: await publicTestimonials(dsaId, testimonials),
    pages: pages.map((p) => ({
      title: p.title,
      slug: p.slug,
      pageType: p.pageType,
      seoTitle: p.seoTitle || '',
      seoDescription: p.seoDescription || '',
      updatedAt: p.updatedAt,
    })),
    banners: banners.map((b) => ({
      title: b.title,
      imageUrl: b.imageUrl,
      linkUrl: b.linkUrl || '',
      placement: b.placement,
      serviceCode: b.serviceCode || '',
      displayOrder: b.displayOrder,
    })),
    blogs: blogs.map(publicBlogCard),
  };
}

async function listPublicBlogs(dsaId, { page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const filter = { dsaId, status: 'PUBLISHED' };
  const [total, rows] = await Promise.all([
    Blog.countDocuments(filter),
    Blog.find(filter)
      .sort({ publishDate: -1, updatedAt: -1 })
      .skip((safePage - 1) * safeSize)
      .limit(safeSize)
      .select(
        'title slug shortDescription featuredImageUrl images publishDate seoTitle seoDescription',
      )
      .lean(),
  ]);
  return {
    items: rows.map(publicBlogCard),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / safeSize)),
    },
  };
}

async function getPublicBlogBySlug(dsaId, slug) {
  const blog = await Blog.findOne({
    dsaId,
    slug: String(slug || '').toLowerCase().trim(),
    status: 'PUBLISHED',
  }).lean();
  if (!blog) return null;
  const card = publicBlogCard(blog);
  return {
    title: blog.title,
    slug: blog.slug,
    shortDescription: blog.shortDescription || '',
    content: blog.content || '',
    featuredImageUrl: card.featuredImageUrl,
    images: card.images,
    publishDate: blog.publishDate,
    seoTitle: blog.seoTitle || '',
    seoDescription: blog.seoDescription || '',
    updatedAt: blog.updatedAt,
  };
}

async function getPublicPageBySlug(dsaId, slug) {
  const page = await CmsPage.findOne({
    dsaId,
    slug: String(slug || '').toLowerCase().trim(),
    status: 'PUBLISHED',
  }).lean();
  if (!page) return null;
  return {
    title: page.title,
    slug: page.slug,
    pageType: page.pageType,
    content: page.content || '',
    seoTitle: page.seoTitle || '',
    seoDescription: page.seoDescription || '',
    updatedAt: page.updatedAt,
  };
}

module.exports = {
  buildPublicSiteConfig,
  listPublicBlogs,
  getPublicBlogBySlug,
  getPublicPageBySlug,
};
