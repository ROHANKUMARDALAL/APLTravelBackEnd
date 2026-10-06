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
const {
  listOfferedServicesForDsa,
} = require('../../tenant/services/service-offer.service');

function publicBranding(settings) {
  return {
    websiteName: settings?.websiteName || '',
    tagline: settings?.tagline || '',
    logoUrl: settings?.logoUrl || '',
    faviconUrl: settings?.faviconUrl || '',
    primaryColor: settings?.primaryColor || '',
  };
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
          'title slug shortDescription featuredImageUrl publishDate seoTitle seoDescription',
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
    branding: publicBranding(settings),
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
    })),
    footer: footerLinks.map((f) => ({
      title: f.title,
      url: f.url,
      group: f.group,
      displayOrder: f.displayOrder,
    })),
    testimonials: testimonials.map((t) => ({
      customerName: t.customerName,
      designation: t.designation || '',
      company: t.company || '',
      message: t.message,
      rating: t.rating,
      imageUrl: t.imageUrl || '',
      displayOrder: t.displayOrder,
    })),
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
    blogs: blogs.map((b) => ({
      title: b.title,
      slug: b.slug,
      shortDescription: b.shortDescription || '',
      featuredImageUrl: b.featuredImageUrl || '',
      publishDate: b.publishDate,
      seoTitle: b.seoTitle || '',
      seoDescription: b.seoDescription || '',
    })),
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
        'title slug shortDescription featuredImageUrl publishDate seoTitle seoDescription',
      )
      .lean(),
  ]);
  return {
    items: rows.map((b) => ({
      title: b.title,
      slug: b.slug,
      shortDescription: b.shortDescription || '',
      featuredImageUrl: b.featuredImageUrl || '',
      publishDate: b.publishDate,
      seoTitle: b.seoTitle || '',
      seoDescription: b.seoDescription || '',
    })),
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
  return {
    title: blog.title,
    slug: blog.slug,
    shortDescription: blog.shortDescription || '',
    content: blog.content || '',
    featuredImageUrl: blog.featuredImageUrl || '',
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
