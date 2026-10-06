'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Banner = require('../models/Banner');
const { BANNER_STATUSES, BANNER_PLACEMENTS } = require('../models/Banner');
const { assertHttpUrl } = require('../utils/sanitize');

function toPublic(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    dsaId: String(o.dsaId),
    title: o.title,
    imageUrl: o.imageUrl,
    linkUrl: o.linkUrl || '',
    placement: o.placement,
    serviceCode: o.serviceCode || '',
    status: o.status,
    displayOrder: o.displayOrder,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function listBanners(dsaId, { status, placement } = {}) {
  const filter = { dsaId };
  if (status) {
    const s = String(status).toUpperCase();
    if (!BANNER_STATUSES.includes(s)) throw AppError.validation('Invalid status');
    filter.status = s;
  }
  if (placement) {
    const p = String(placement).toUpperCase();
    if (!BANNER_PLACEMENTS.includes(p)) {
      throw AppError.validation('Invalid placement');
    }
    filter.placement = p;
  }
  const rows = await Banner.find(filter)
    .sort({ placement: 1, displayOrder: 1, createdAt: -1 })
    .lean();
  return rows.map(toPublic);
}

async function getForTenant(dsaId, id) {
  if (!Types.ObjectId.isValid(id)) throw AppError.validation('Invalid id');
  const doc = await Banner.findOne({ _id: id, dsaId });
  if (!doc) throw AppError.notFound('Banner not found');
  return doc;
}

async function createBanner(dsaId, input = {}) {
  const title = String(input.title || '').trim();
  const imageUrl = String(input.imageUrl || '').trim();
  if (!title) throw AppError.validation('title is required');
  if (!imageUrl) throw AppError.validation('imageUrl is required');
  const placement = String(input.placement || 'HOME_HERO').toUpperCase();
  if (!BANNER_PLACEMENTS.includes(placement)) {
    throw AppError.validation('Invalid placement');
  }
  const status = String(input.status || 'ACTIVE').toUpperCase();
  if (!BANNER_STATUSES.includes(status)) throw AppError.validation('Invalid status');

  let linkUrl = String(input.linkUrl || '').trim();
  if (linkUrl && !linkUrl.startsWith('/')) {
    linkUrl = assertHttpUrl(linkUrl, 'linkUrl');
  }

  const doc = await Banner.create({
    dsaId,
    title,
    imageUrl,
    linkUrl,
    placement,
    serviceCode: String(input.serviceCode || '').trim().toLowerCase(),
    status,
    displayOrder:
      input.displayOrder === undefined ? 100 : Number(input.displayOrder),
  });
  return toPublic(doc);
}

async function updateBanner(dsaId, id, input = {}) {
  const doc = await getForTenant(dsaId, id);
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw AppError.validation('title is required');
    doc.title = title;
  }
  if (input.imageUrl !== undefined) {
    const imageUrl = String(input.imageUrl || '').trim();
    if (!imageUrl) throw AppError.validation('imageUrl is required');
    doc.imageUrl = imageUrl;
  }
  if (input.linkUrl !== undefined) {
    let linkUrl = String(input.linkUrl || '').trim();
    if (linkUrl && !linkUrl.startsWith('/')) {
      linkUrl = assertHttpUrl(linkUrl, 'linkUrl');
    }
    doc.linkUrl = linkUrl;
  }
  if (input.placement !== undefined) {
    const placement = String(input.placement).toUpperCase();
    if (!BANNER_PLACEMENTS.includes(placement)) {
      throw AppError.validation('Invalid placement');
    }
    doc.placement = placement;
  }
  if (input.serviceCode !== undefined) {
    doc.serviceCode = String(input.serviceCode || '').trim().toLowerCase();
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!BANNER_STATUSES.includes(status)) throw AppError.validation('Invalid status');
    doc.status = status;
  }
  if (input.displayOrder !== undefined) {
    doc.displayOrder = Number(input.displayOrder);
  }
  await doc.save();
  return toPublic(doc);
}

async function deleteBanner(dsaId, id) {
  const doc = await getForTenant(dsaId, id);
  await Banner.deleteOne({ _id: doc._id, dsaId });
  return { deleted: true, id: String(doc._id) };
}

module.exports = {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  toPublic,
};
