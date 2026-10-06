'use strict';

const { mongoose } = require('../../common/database/connection');

const BLOG_STATUSES = ['DRAFT', 'PUBLISHED', 'INACTIVE'];

const BlogSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    shortDescription: { type: String, trim: true, default: '', maxlength: 500 },
    content: { type: String, trim: true, default: '', maxlength: 100000 },
    featuredImageUrl: { type: String, trim: true, default: '', maxlength: 500 },
    seoTitle: { type: String, trim: true, default: '', maxlength: 160 },
    seoDescription: { type: String, trim: true, default: '', maxlength: 320 },
    status: {
      type: String,
      enum: BLOG_STATUSES,
      default: 'DRAFT',
      index: true,
    },
    publishDate: { type: Date, default: null },
  },
  { timestamps: true },
);

BlogSchema.index({ dsaId: 1, slug: 1 }, { unique: true });
BlogSchema.index({ dsaId: 1, status: 1, publishDate: -1 });

module.exports = mongoose.models.Blog || mongoose.model('Blog', BlogSchema);
module.exports.BLOG_STATUSES = BLOG_STATUSES;
