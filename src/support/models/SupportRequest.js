'use strict';

const { mongoose } = require('../../common/database/connection');

const CATEGORIES = [
  'GENERAL',
  'BOOKING',
  'PAYMENT',
  'WALLET',
  'REFUND',
  'RECHARGE',
  'TECHNICAL',
  'OTHER',
];

const SERVICES = ['flight', 'hotel', 'bus', 'transfer', 'recharge', 'insurance', 'holiday', 'visa', 'general'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const SupportRequestSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', required: true, index: true },
    dsaCode: { type: String, default: '' },
    dsaName: { type: String, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerName: { type: String, required: true, maxlength: 160 },
    email: { type: String, required: true, maxlength: 254 },
    phone: { type: String, default: '', maxlength: 40 },
    category: { type: String, enum: CATEGORIES, required: true },
    service: { type: String, enum: SERVICES, default: 'general' },
    bookingReference: { type: String, default: '', maxlength: 40 },
    subject: { type: String, required: true, maxlength: 160 },
    message: { type: String, required: true, maxlength: 4000 },
    status: { type: String, enum: STATUSES, default: 'OPEN', index: true },
    assignedTo: { type: String, default: '', maxlength: 160 },
    adminNotes: { type: String, default: '', maxlength: 4000 },
    replies: {
      type: [{
        at: { type: Date, default: Date.now },
        actorName: { type: String, default: '' },
        message: { type: String, maxlength: 2000 },
      }],
      default: [],
    },
    activity: {
      type: [{
        at: { type: Date, default: Date.now },
        actorName: { type: String, default: '' },
        action: { type: String, required: true },
        fromStatus: { type: String, default: '' },
        toStatus: { type: String, default: '' },
        note: { type: String, default: '', maxlength: 500 },
      }],
      default: [],
    },
    idempotencyKey: { type: String, default: '' },
  },
  { timestamps: true },
);

SupportRequestSchema.index(
  { dsaId: 1, userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: '' } } },
);

const Model = mongoose.models.SupportRequest || mongoose.model('SupportRequest', SupportRequestSchema);
module.exports = Model;
module.exports.CATEGORIES = CATEGORIES;
module.exports.SERVICES = SERVICES;
module.exports.STATUSES = STATUSES;
