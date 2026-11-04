'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Testimonial = require('../models/Testimonial');
const { TESTIMONIAL_STATUSES } = require('../models/Testimonial');
const { sanitizeRichText } = require('../utils/sanitize');

function toPublic(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    dsaId: String(o.dsaId),
    customerName: o.customerName,
    designation: o.designation || '',
    company: o.company || '',
    title: o.title || '',
    message: o.message,
    relatedService: o.relatedService || '',
    source: o.source || 'ADMIN',
    rating: o.rating,
    imageUrl: o.imageUrl || '',
    status: o.status,
    displayOrder: o.displayOrder,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function listTestimonials(dsaId, { status } = {}) {
  const filter = { dsaId, deletedAt: null };
  if (status) {
    const s = String(status).toUpperCase();
    if (!TESTIMONIAL_STATUSES.includes(s)) {
      throw AppError.validation('Invalid testimonial status');
    }
    filter.status = s;
  }
  const rows = await Testimonial.find(filter)
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
  return rows.map(toPublic);
}

async function getForTenant(dsaId, id) {
  if (!Types.ObjectId.isValid(id)) throw AppError.validation('Invalid id');
  const doc = await Testimonial.findOne({ _id: id, dsaId, deletedAt: null });
  if (!doc) throw AppError.notFound('Testimonial not found');
  return doc;
}

async function createTestimonial(dsaId, input = {}) {
  const customerName = String(input.customerName || '').trim();
  const message = sanitizeRichText(input.message);
  if (!customerName) throw AppError.validation('customerName is required');
  if (!message) throw AppError.validation('message is required');
  const rating = Number(input.rating ?? 5);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw AppError.validation('rating must be an integer from 1 to 5');
  }
  const status = String(input.status || 'ACTIVE').toUpperCase();
  if (!TESTIMONIAL_STATUSES.includes(status)) {
    throw AppError.validation('Invalid status');
  }
  const doc = await Testimonial.create({
    dsaId,
    customerName,
    designation: String(input.designation || '').trim(),
    company: String(input.company || '').trim(),
    message,
    rating,
    imageUrl: String(input.imageUrl || '').trim(),
    status,
    displayOrder:
      input.displayOrder === undefined ? 100 : Number(input.displayOrder),
  });
  return toPublic(doc);
}

async function updateTestimonial(dsaId, id, input = {}) {
  const doc = await getForTenant(dsaId, id);
  if (input.customerName !== undefined) {
    const customerName = String(input.customerName || '').trim();
    if (!customerName) throw AppError.validation('customerName is required');
    doc.customerName = customerName;
  }
  if (input.designation !== undefined) {
    doc.designation = String(input.designation || '').trim();
  }
  if (input.company !== undefined) doc.company = String(input.company || '').trim();
  if (input.message !== undefined) {
    const message = sanitizeRichText(input.message);
    if (!message) throw AppError.validation('message is required');
    doc.message = message;
  }
  if (input.rating !== undefined) {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw AppError.validation('rating must be an integer from 1 to 5');
    }
    doc.rating = rating;
  }
  if (input.imageUrl !== undefined) doc.imageUrl = String(input.imageUrl || '').trim();
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!TESTIMONIAL_STATUSES.includes(status)) {
      throw AppError.validation('Invalid status');
    }
    doc.status = status;
  }
  if (input.displayOrder !== undefined) {
    doc.displayOrder = Number(input.displayOrder);
  }
  await doc.save();
  return toPublic(doc);
}

const SERVICES = ['flight', 'hotel', 'bus', 'transfer', 'recharge', 'insurance', 'holiday', 'visa', 'general', ''];

function plainReview(value, max) {
  return sanitizeRichText(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function reviewInput(input) {
  const message = plainReview(input.message, 2000);
  if (message.length < 10) throw AppError.validation('Write at least 10 characters');
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw AppError.validation('Choose a rating from 1 to 5');
  const relatedService = String(input.relatedService || '').toLowerCase();
  if (!SERVICES.includes(relatedService)) throw AppError.validation('Choose a related service');
  return { message, rating, relatedService, title: plainReview(input.title, 160) };
}

async function createCustomerReview({ dsaId, user, input }) {
  if (!dsaId) throw AppError.forbidden('This website is not available');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await Testimonial.countDocuments({ dsaId, customerId: user._id, source: 'CUSTOMER', deletedAt: null, createdAt: { $gte: since } });
  if (recent >= 2) throw AppError.validation('Please wait before submitting another review');
  const fields = reviewInput(input);
  const duplicate = await Testimonial.findOne({ dsaId, customerId: user._id, source: 'CUSTOMER', deletedAt: null, message: fields.message });
  if (duplicate) throw AppError.validation('You already submitted this review');
  const doc = await Testimonial.create({
    dsaId,
    customerId: user._id,
    customerName: user.name,
    title: fields.title,
    message: fields.message,
    rating: fields.rating,
    imageUrl: user.profilePhoto || '',
    relatedService: fields.relatedService,
    source: 'CUSTOMER',
    status: 'ACTIVE',
    displayOrder: 50,
  });
  return toPublic(doc);
}

async function updateCustomerReview({ dsaId, user, reviewId, input }) {
  if (!dsaId) throw AppError.forbidden('This website is not available');
  if (!Types.ObjectId.isValid(reviewId)) throw AppError.notFound('Review not found');
  const doc = await Testimonial.findOne({ _id: reviewId, dsaId, customerId: user._id, source: 'CUSTOMER', deletedAt: null });
  if (!doc) throw AppError.notFound('Review not found');
  const fields = reviewInput(input);
  doc.title = fields.title;
  doc.message = fields.message;
  doc.rating = fields.rating;
  doc.relatedService = fields.relatedService;
  await doc.save();
  return toPublic(doc);
}

async function deleteCustomerReview({ dsaId, user, reviewId }) {
  if (!dsaId) throw AppError.forbidden('This website is not available');
  if (!Types.ObjectId.isValid(reviewId)) throw AppError.notFound('Review not found');
  const doc = await Testimonial.findOne({ _id: reviewId, dsaId, customerId: user._id, source: 'CUSTOMER', deletedAt: null });
  if (!doc) throw AppError.notFound('Review not found');
  doc.deletedAt = new Date();
  doc.status = 'INACTIVE';
  await doc.save();
  return { deleted: true, id: String(doc._id) };
}

async function listCustomerReviews(dsaId, userId) {
  const rows = await Testimonial.find({ dsaId, customerId: userId, source: 'CUSTOMER', deletedAt: null }).sort({ createdAt: -1 }).limit(20).lean();
  return rows.map(toPublic);
}

async function deleteTestimonial(dsaId, id) {
  const doc = await getForTenant(dsaId, id);
  await Testimonial.deleteOne({ _id: doc._id, dsaId });
  return { deleted: true, id: String(doc._id) };
}

module.exports = {
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  createCustomerReview,
  updateCustomerReview,
  deleteCustomerReview,
  listCustomerReviews,
  toPublic,
};
