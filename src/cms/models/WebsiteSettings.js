'use strict';

const { mongoose } = require('../../common/database/connection');

const WebsiteSettingsSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      unique: true,
      index: true,
    },
    websiteName: { type: String, trim: true, default: '', maxlength: 160 },
    tagline: { type: String, trim: true, default: '', maxlength: 240 },
    logoUrl: { type: String, trim: true, default: '', maxlength: 500 },
    faviconUrl: { type: String, trim: true, default: '', maxlength: 500 },
    primaryColor: { type: String, trim: true, default: '', maxlength: 32 },
    contact: {
      email: { type: String, trim: true, lowercase: true, default: '', maxlength: 254 },
      phone: { type: String, trim: true, default: '', maxlength: 40 },
      alternatePhone: { type: String, trim: true, default: '', maxlength: 40 },
      address: { type: String, trim: true, default: '', maxlength: 500 },
    },
    social: {
      facebook: { type: String, trim: true, default: '', maxlength: 500 },
      instagram: { type: String, trim: true, default: '', maxlength: 500 },
      linkedin: { type: String, trim: true, default: '', maxlength: 500 },
      twitter: { type: String, trim: true, default: '', maxlength: 500 },
      youtube: { type: String, trim: true, default: '', maxlength: 500 },
    },
    seo: {
      defaultTitle: { type: String, trim: true, default: '', maxlength: 160 },
      defaultDescription: { type: String, trim: true, default: '', maxlength: 320 },
      keywords: { type: String, trim: true, default: '', maxlength: 400 },
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.WebsiteSettings ||
  mongoose.model('WebsiteSettings', WebsiteSettingsSchema);
