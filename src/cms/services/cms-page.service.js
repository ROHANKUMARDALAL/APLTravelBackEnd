'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const CmsPage = require('../models/CmsPage');
const { CMS_PAGE_STATUSES, CMS_PAGE_TYPES } = require('../models/CmsPage');
const { assertSlug, slugify } = require('../utils/slug');
const { sanitizeRichText } = require('../utils/sanitize');

function toPublic(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    dsaId: String(o.dsaId),
    title: o.title,
    slug: o.slug,
    pageType: o.pageType,
    content: o.content || '',
    seoTitle: o.seoTitle || '',
    seoDescription: o.seoDescription || '',
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function listCmsPages(dsaId, { status, pageType } = {}) {
  const filter = { dsaId };
  if (status) {
    const s = String(status).toUpperCase();
    if (!CMS_PAGE_STATUSES.includes(s)) throw AppError.validation('Invalid status');
    filter.status = s;
  }
  if (pageType) {
    const t = String(pageType).toUpperCase();
    if (!CMS_PAGE_TYPES.includes(t)) throw AppError.validation('Invalid pageType');
    filter.pageType = t;
  }
  const rows = await CmsPage.find(filter).sort({ updatedAt: -1 }).lean();
  return rows.map(toPublic);
}

async function getForTenant(dsaId, id) {
  if (!Types.ObjectId.isValid(id)) throw AppError.validation('Invalid id');
  const doc = await CmsPage.findOne({ _id: id, dsaId });
  if (!doc) throw AppError.notFound('CMS page not found');
  return doc;
}

async function createCmsPage(dsaId, input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw AppError.validation('title is required');
  const slug = assertSlug(input.slug || slugify(title));
  const pageType = String(input.pageType || 'CUSTOM').toUpperCase();
  if (!CMS_PAGE_TYPES.includes(pageType)) {
    throw AppError.validation('Invalid pageType');
  }
  const status = String(input.status || 'DRAFT').toUpperCase();
  if (!CMS_PAGE_STATUSES.includes(status)) {
    throw AppError.validation('Invalid status');
  }
  try {
    const doc = await CmsPage.create({
      dsaId,
      title,
      slug,
      pageType,
      content: sanitizeRichText(input.content),
      seoTitle: String(input.seoTitle || '').trim(),
      seoDescription: String(input.seoDescription || '').trim(),
      status,
    });
    return toPublic(doc);
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Page slug already exists for this DSA');
    }
    throw error;
  }
}

async function updateCmsPage(dsaId, id, input = {}) {
  const doc = await getForTenant(dsaId, id);
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw AppError.validation('title is required');
    doc.title = title;
  }
  if (input.slug !== undefined) doc.slug = assertSlug(input.slug);
  if (input.pageType !== undefined) {
    const pageType = String(input.pageType).toUpperCase();
    if (!CMS_PAGE_TYPES.includes(pageType)) {
      throw AppError.validation('Invalid pageType');
    }
    doc.pageType = pageType;
  }
  if (input.content !== undefined) doc.content = sanitizeRichText(input.content);
  if (input.seoTitle !== undefined) doc.seoTitle = String(input.seoTitle || '').trim();
  if (input.seoDescription !== undefined) {
    doc.seoDescription = String(input.seoDescription || '').trim();
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!CMS_PAGE_STATUSES.includes(status)) {
      throw AppError.validation('Invalid status');
    }
    doc.status = status;
  }
  try {
    await doc.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Page slug already exists for this DSA');
    }
    throw error;
  }
  return toPublic(doc);
}

async function deleteCmsPage(dsaId, id) {
  const doc = await getForTenant(dsaId, id);
  await CmsPage.deleteOne({ _id: doc._id, dsaId });
  return { deleted: true, id: String(doc._id) };
}

module.exports = {
  listCmsPages,
  createCmsPage,
  updateCmsPage,
  deleteCmsPage,
  getForTenant,
  toPublic,
};
