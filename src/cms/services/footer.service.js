'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const FooterLink = require('../models/FooterLink');
const { FOOTER_STATUSES } = require('../models/FooterLink');
const { assertHttpUrl } = require('../utils/sanitize');

function normalizeLinkUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw AppError.validation('url is required');
  if (raw.startsWith('/')) return raw;
  return assertHttpUrl(raw, 'url');
}

function toPublic(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    dsaId: String(o.dsaId),
    title: o.title,
    url: o.url,
    group: o.group,
    status: o.status,
    displayOrder: o.displayOrder,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function listFooterLinks(dsaId, { status } = {}) {
  const filter = { dsaId };
  if (status) {
    const s = String(status).toUpperCase();
    if (!FOOTER_STATUSES.includes(s)) throw AppError.validation('Invalid status');
    filter.status = s;
  }
  const rows = await FooterLink.find(filter)
    .sort({ group: 1, displayOrder: 1, createdAt: -1 })
    .lean();
  return rows.map(toPublic);
}

async function getForTenant(dsaId, id) {
  if (!Types.ObjectId.isValid(id)) throw AppError.validation('Invalid id');
  const doc = await FooterLink.findOne({ _id: id, dsaId });
  if (!doc) throw AppError.notFound('Footer link not found');
  return doc;
}

async function createFooterLink(dsaId, input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw AppError.validation('title is required');
  const status = String(input.status || 'ACTIVE').toUpperCase();
  if (!FOOTER_STATUSES.includes(status)) throw AppError.validation('Invalid status');

  const doc = await FooterLink.create({
    dsaId,
    title,
    url: normalizeLinkUrl(input.url),
    group: String(input.group || 'Company').trim() || 'Company',
    status,
    displayOrder:
      input.displayOrder === undefined ? 100 : Number(input.displayOrder),
  });
  return toPublic(doc);
}

async function updateFooterLink(dsaId, id, input = {}) {
  const doc = await getForTenant(dsaId, id);
  if (input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw AppError.validation('title is required');
    doc.title = title;
  }
  if (input.url !== undefined) doc.url = normalizeLinkUrl(input.url);
  if (input.group !== undefined) {
    doc.group = String(input.group || 'Company').trim() || 'Company';
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!FOOTER_STATUSES.includes(status)) throw AppError.validation('Invalid status');
    doc.status = status;
  }
  if (input.displayOrder !== undefined) {
    doc.displayOrder = Number(input.displayOrder);
  }
  await doc.save();
  return toPublic(doc);
}

async function deleteFooterLink(dsaId, id) {
  const doc = await getForTenant(dsaId, id);
  await FooterLink.deleteOne({ _id: doc._id, dsaId });
  return { deleted: true, id: String(doc._id) };
}

module.exports = {
  listFooterLinks,
  createFooterLink,
  updateFooterLink,
  deleteFooterLink,
  toPublic,
};
