'use strict';

const { mongoose } = require('../../common/database/connection');

const BANNER_STATUSES = ['ACTIVE', 'INACTIVE'];
const BANNER_PLACEMENTS = ['HOME_HERO', 'HOME_SECONDARY', 'SERVICE', 'PROMO'];

const BannerSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    imageUrl: { type: String, required: true, trim: true, maxlength: 500 },
    linkUrl: { type: String, trim: true, default: '', maxlength: 500 },
    placement: {
      type: String,
      enum: BANNER_PLACEMENTS,
      default: 'HOME_HERO',
      index: true,
    },
    serviceCode: { type: String, trim: true, lowercase: true, default: '', maxlength: 64 },
    status: {
      type: String,
      enum: BANNER_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    displayOrder: { type: Number, default: 100, min: 0 },
  },
  { timestamps: true },
);

BannerSchema.index({ dsaId: 1, placement: 1, displayOrder: 1 });

module.exports = mongoose.models.Banner || mongoose.model('Banner', BannerSchema);
module.exports.BANNER_STATUSES = BANNER_STATUSES;
module.exports.BANNER_PLACEMENTS = BANNER_PLACEMENTS;
