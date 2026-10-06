'use strict';

const { mongoose } = require('../../common/database/connection');

const CMS_PAGE_STATUSES = ['DRAFT', 'PUBLISHED', 'INACTIVE'];
const CMS_PAGE_TYPES = [
  'ABOUT',
  'CONTACT',
  'TERMS',
  'PRIVACY',
  'CANCELLATION',
  'REFUND',
  'CUSTOM',
];

const CmsPageSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    pageType: {
      type: String,
      enum: CMS_PAGE_TYPES,
      default: 'CUSTOM',
      index: true,
    },
    content: { type: String, trim: true, default: '', maxlength: 100000 },
    seoTitle: { type: String, trim: true, default: '', maxlength: 160 },
    seoDescription: { type: String, trim: true, default: '', maxlength: 320 },
    status: {
      type: String,
      enum: CMS_PAGE_STATUSES,
      default: 'DRAFT',
      index: true,
    },
  },
  { timestamps: true },
);

CmsPageSchema.index({ dsaId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.models.CmsPage || mongoose.model('CmsPage', CmsPageSchema);
module.exports.CMS_PAGE_STATUSES = CMS_PAGE_STATUSES;
module.exports.CMS_PAGE_TYPES = CMS_PAGE_TYPES;
