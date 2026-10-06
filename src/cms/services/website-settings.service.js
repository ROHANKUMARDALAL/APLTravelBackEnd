'use strict';

const WebsiteSettings = require('../models/WebsiteSettings');
const { assertHttpUrl } = require('../utils/sanitize');

function toPublic(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    dsaId: String(o.dsaId),
    websiteName: o.websiteName || '',
    tagline: o.tagline || '',
    logoUrl: o.logoUrl || '',
    faviconUrl: o.faviconUrl || '',
    primaryColor: o.primaryColor || '',
    contact: {
      email: o.contact?.email || '',
      phone: o.contact?.phone || '',
      alternatePhone: o.contact?.alternatePhone || '',
      address: o.contact?.address || '',
    },
    social: {
      facebook: o.social?.facebook || '',
      instagram: o.social?.instagram || '',
      linkedin: o.social?.linkedin || '',
      twitter: o.social?.twitter || '',
      youtube: o.social?.youtube || '',
    },
    seo: {
      defaultTitle: o.seo?.defaultTitle || '',
      defaultDescription: o.seo?.defaultDescription || '',
      keywords: o.seo?.keywords || '',
    },
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function getOrCreateWebsiteSettings(dsaId) {
  let doc = await WebsiteSettings.findOne({ dsaId });
  if (!doc) {
    doc = await WebsiteSettings.create({ dsaId });
  }
  return doc;
}

async function getWebsiteSettings(dsaId) {
  const doc = await getOrCreateWebsiteSettings(dsaId);
  return toPublic(doc);
}

async function updateWebsiteSettings(dsaId, input = {}) {
  const doc = await getOrCreateWebsiteSettings(dsaId);

  if (input.websiteName !== undefined) {
    doc.websiteName = String(input.websiteName || '').trim();
  }
  if (input.tagline !== undefined) doc.tagline = String(input.tagline || '').trim();
  if (input.logoUrl !== undefined) doc.logoUrl = String(input.logoUrl || '').trim();
  if (input.faviconUrl !== undefined) {
    doc.faviconUrl = String(input.faviconUrl || '').trim();
  }
  if (input.primaryColor !== undefined) {
    doc.primaryColor = String(input.primaryColor || '').trim();
  }

  if (input.contact) {
    doc.contact = {
      email: String(input.contact.email || '').trim().toLowerCase(),
      phone: String(input.contact.phone || '').trim(),
      alternatePhone: String(input.contact.alternatePhone || '').trim(),
      address: String(input.contact.address || '').trim(),
    };
  }

  if (input.social) {
    doc.social = {
      facebook: assertHttpUrl(input.social.facebook, 'facebook'),
      instagram: assertHttpUrl(input.social.instagram, 'instagram'),
      linkedin: assertHttpUrl(input.social.linkedin, 'linkedin'),
      twitter: assertHttpUrl(input.social.twitter, 'twitter'),
      youtube: assertHttpUrl(input.social.youtube, 'youtube'),
    };
  }

  if (input.seo) {
    doc.seo = {
      defaultTitle: String(input.seo.defaultTitle || '').trim(),
      defaultDescription: String(input.seo.defaultDescription || '').trim(),
      keywords: String(input.seo.keywords || '').trim(),
    };
  }

  await doc.save();
  return toPublic(doc);
}

module.exports = {
  getWebsiteSettings,
  updateWebsiteSettings,
  getOrCreateWebsiteSettings,
  toPublic,
};
