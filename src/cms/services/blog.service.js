'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Blog = require('../models/Blog');
const { BLOG_STATUSES } = require('../models/Blog');
const { assertSlug, slugify } = require('../utils/slug');
const { sanitizeRichText } = require('../utils/sanitize');

function toPublic(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    dsaId: String(o.dsaId),
    title: o.title,
    slug: o.slug,
    shortDescription: o.shortDescription || '',
    content: o.content || '',
    featuredImageUrl: o.featuredImageUrl || '',
    seoTitle: o.seoTitle || '',
    seoDescription: o.seoDescription || '',
    status: o.status,
    publishDate: o.publishDate,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function listBlogs(dsaId, { q, status, page = 1, pageSize = 20 } = {}) {
  const filter = { dsaId };
  if (status) {
    const s = String(status).toUpperCase();
    if (!BLOG_STATUSES.includes(s)) throw AppError.validation('Invalid blog status');
    filter.status = s;
  }
  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { slug: rx }, { shortDescription: rx }];
  }
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const [total, rows] = await Promise.all([
    Blog.countDocuments(filter),
    Blog.find(filter)
      .sort({ updatedAt: -1 })
      .skip((safePage - 1) * safeSize)
      .limit(safeSize)
      .lean(),
  ]);
  return {
    items: rows.map(toPublic),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / safeSize)),
    },
  };
}

async function getBlogForTenant(dsaId, blogId) {
  if (!Types.ObjectId.isValid(blogId)) throw AppError.validation('Invalid blog id');
  const blog = await Blog.findOne({ _id: blogId, dsaId });
  if (!blog) throw AppError.notFound('Blog not found');
  return blog;
}

async function createBlog(dsaId, input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw AppError.validation('title is required');
  const slug = assertSlug(input.slug || slugify(title));
  const status = String(input.status || 'DRAFT').toUpperCase();
  if (!BLOG_STATUSES.includes(status)) throw AppError.validation('Invalid status');

  try {
    const blog = await Blog.create({
      dsaId,
      title,
      slug,
      shortDescription: String(input.shortDescription || '').trim(),
      content: sanitizeRichText(input.content),
      featuredImageUrl: String(input.featuredImageUrl || '').trim(),
      seoTitle: String(input.seoTitle || '').trim(),
      seoDescription: String(input.seoDescription || '').trim(),
      status,
      publishDate: status === 'PUBLISHED' ? input.publishDate || new Date() : null,
    });
    return toPublic(blog);
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Blog slug already exists for this DSA');
    }
    throw error;
  }
}

async function updateBlog(dsaId, blogId, input = {}) {
  const blog = await getBlogForTenant(dsaId, blogId);
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw AppError.validation('title is required');
    blog.title = title;
  }
  if (input.slug !== undefined) blog.slug = assertSlug(input.slug);
  if (input.shortDescription !== undefined) {
    blog.shortDescription = String(input.shortDescription || '').trim();
  }
  if (input.content !== undefined) blog.content = sanitizeRichText(input.content);
  if (input.featuredImageUrl !== undefined) {
    blog.featuredImageUrl = String(input.featuredImageUrl || '').trim();
  }
  if (input.seoTitle !== undefined) blog.seoTitle = String(input.seoTitle || '').trim();
  if (input.seoDescription !== undefined) {
    blog.seoDescription = String(input.seoDescription || '').trim();
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!BLOG_STATUSES.includes(status)) throw AppError.validation('Invalid status');
    blog.status = status;
    if (status === 'PUBLISHED' && !blog.publishDate) blog.publishDate = new Date();
    if (status !== 'PUBLISHED' && input.clearPublishDate) blog.publishDate = null;
  }
  if (input.publishDate !== undefined) {
    blog.publishDate = input.publishDate ? new Date(input.publishDate) : null;
  }
  try {
    await blog.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Blog slug already exists for this DSA');
    }
    throw error;
  }
  return toPublic(blog);
}

async function deleteBlog(dsaId, blogId) {
  const blog = await getBlogForTenant(dsaId, blogId);
  await Blog.deleteOne({ _id: blog._id, dsaId });
  return { deleted: true, id: String(blog._id) };
}

module.exports = {
  listBlogs,
  getBlogForTenant,
  createBlog,
  updateBlog,
  deleteBlog,
  toPublic,
};
