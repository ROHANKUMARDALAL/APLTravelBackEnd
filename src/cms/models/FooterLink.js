'use strict';

const { mongoose } = require('../../common/database/connection');

const FOOTER_STATUSES = ['ACTIVE', 'INACTIVE'];

const FooterLinkSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    url: { type: String, required: true, trim: true, maxlength: 500 },
    group: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      default: 'Company',
    },
    status: {
      type: String,
      enum: FOOTER_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    displayOrder: { type: Number, default: 100, min: 0 },
  },
  { timestamps: true },
);

FooterLinkSchema.index({ dsaId: 1, group: 1, displayOrder: 1 });

module.exports =
  mongoose.models.FooterLink || mongoose.model('FooterLink', FooterLinkSchema);
module.exports.FOOTER_STATUSES = FOOTER_STATUSES;
