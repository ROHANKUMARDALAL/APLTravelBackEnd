'use strict';

const { mongoose } = require('../../common/database/connection');

const TESTIMONIAL_STATUSES = ['ACTIVE', 'INACTIVE'];

const TestimonialSchema = new mongoose.Schema(
  {
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      required: true,
      index: true,
    },
    customerName: { type: String, required: true, trim: true, maxlength: 160 },
    designation: { type: String, trim: true, default: '', maxlength: 160 },
    company: { type: String, trim: true, default: '', maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    rating: { type: Number, required: true, min: 1, max: 5, default: 5 },
    imageUrl: { type: String, trim: true, default: '', maxlength: 500 },
    status: {
      type: String,
      enum: TESTIMONIAL_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    displayOrder: { type: Number, default: 100, min: 0 },
  },
  { timestamps: true },
);

TestimonialSchema.index({ dsaId: 1, status: 1, displayOrder: 1 });

module.exports =
  mongoose.models.Testimonial || mongoose.model('Testimonial', TestimonialSchema);
module.exports.TESTIMONIAL_STATUSES = TESTIMONIAL_STATUSES;
