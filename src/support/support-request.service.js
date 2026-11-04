'use strict';

const crypto = require('crypto');
const { AppError } = require('../common/errors/app-error');
const { sanitizeRichText } = require('../cms/utils/sanitize');
const SupportRequest = require('./models/SupportRequest');
const { CATEGORIES, SERVICES, STATUSES } = require('./models/SupportRequest');
const Dsa = require('../tenant/models/Dsa');
const { Booking } = require('../common/database/models/Booking');
const RechargeOrder = require('../recharge/models/RechargeOrder');

function plain(value, max) {
  return sanitizeRichText(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function presentCustomer(row) {
  return {
    reference: row.reference,
    category: row.category,
    service: row.service,
    bookingReference: row.bookingReference || '',
    subject: row.subject,
    message: row.message,
    status: row.status,
    replies: (row.replies || []).map((item) => ({
      at: item.at,
      actorName: item.actorName,
      message: item.message,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function presentAdmin(row) {
  return {
    ...presentCustomer(row),
    id: String(row._id),
    dsaId: String(row.dsaId),
    dsaCode: row.dsaCode || '',
    dsaName: row.dsaName || '',
    userId: String(row.userId),
    customerName: row.customerName,
    email: row.email,
    phone: row.phone,
    assignedTo: row.assignedTo || '',
    adminNotes: row.adminNotes || '',
    activity: row.activity || [],
  };
}

async function assertOwnedReference(dsaId, userId, reference) {
  const ref = plain(reference, 40);
  if (!ref) return '';
  const booking = await Booking.findOne({ aplBookingRef: ref, userId, dsaId }).select('_id').lean();
  const recharge = booking ? null : await RechargeOrder.findOne({
    $or: [{ reference: ref }, { 'summary.bookingReference': ref }],
    userId,
    dsaId,
  }).select('_id').lean();
  if (!booking && !recharge) throw AppError.validation('That booking reference is not on this account');
  return ref;
}

async function createSupportRequest({ dsaId, user, input, idempotencyKey }) {
  if (!dsaId) throw AppError.forbidden('This website is not available');
  const key = plain(idempotencyKey, 80);
  if (key) {
    const existing = await SupportRequest.findOne({ dsaId, userId: user._id, idempotencyKey: key }).lean();
    if (existing) return { request: presentCustomer(existing), replay: true };
  }
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await SupportRequest.countDocuments({ userId: user._id, dsaId, createdAt: { $gte: since } });
  if (recent >= 5) throw AppError.validation('Please wait before sending another support request');
  const category = String(input.category || '').toUpperCase();
  const service = String(input.service || 'general').toLowerCase();
  if (!CATEGORIES.includes(category)) throw AppError.validation('Choose an enquiry type');
  if (!SERVICES.includes(service)) throw AppError.validation('Choose a related service');
  const subject = plain(input.subject, 160);
  const message = plain(input.message, 4000);
  if (subject.length < 3) throw AppError.validation('Enter a subject');
  if (message.length < 10) throw AppError.validation('Describe the request in at least 10 characters');
  const bookingReference = await assertOwnedReference(dsaId, user._id, input.bookingReference);
  const dsa = await Dsa.findById(dsaId).select('dsaCode displayName companyName').lean();
  const reference = `APL-SUP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    const created = await SupportRequest.create({
      reference,
      dsaId,
      dsaCode: dsa?.dsaCode || '',
      dsaName: dsa?.displayName || dsa?.companyName || '',
      userId: user._id,
      customerName: user.name,
      email: user.email,
      phone: user.phoneNumber || '',
      category,
      service,
      bookingReference,
      subject,
      message,
      status: 'OPEN',
      idempotencyKey: key,
      activity: [{ action: 'CREATED', toStatus: 'OPEN', actorName: user.name }],
    });
    return { request: presentCustomer(created.toObject()), replay: false };
  } catch (error) {
    if (error && error.code === 11000 && key) {
      const existing = await SupportRequest.findOne({ dsaId, userId: user._id, idempotencyKey: key }).lean();
      if (existing) return { request: presentCustomer(existing), replay: true };
    }
    throw error;
  }
}

async function listForCustomer(dsaId, userId) {
  const rows = await SupportRequest.find({ dsaId, userId }).sort({ createdAt: -1 }).limit(50).lean();
  return rows.map(presentCustomer);
}

async function listForDsa(dsaId, query = {}) {
  const filter = { dsaId };
  if (query.status && STATUSES.includes(String(query.status).toUpperCase())) filter.status = String(query.status).toUpperCase();
  if (query.category && CATEGORIES.includes(String(query.category).toUpperCase())) filter.category = String(query.category).toUpperCase();
  if (query.service && SERVICES.includes(String(query.service).toLowerCase())) filter.service = String(query.service).toLowerCase();
  const q = plain(query.q, 80);
  if (q) {
    filter.$or = [
      { reference: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { subject: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { customerName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }
  const rows = await SupportRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const summary = { total: rows.length, open: 0, inProgress: 0, resolved: 0 };
  for (const row of rows) {
    if (row.status === 'OPEN') summary.open += 1;
    if (row.status === 'IN_PROGRESS') summary.inProgress += 1;
    if (row.status === 'RESOLVED' || row.status === 'CLOSED') summary.resolved += 1;
  }
  return { summary, requests: rows.map(presentAdmin) };
}

async function getForDsa(dsaId, reference) {
  const row = await SupportRequest.findOne({ dsaId, reference: String(reference || '') }).lean();
  if (!row) throw AppError.notFound('Support request not found');
  return presentAdmin(row);
}

async function updateForDsa(dsaId, reference, input, actorName) {
  const doc = await SupportRequest.findOne({ dsaId, reference: String(reference || '') });
  if (!doc) throw AppError.notFound('Support request not found');
  const from = doc.status;
  if (input.status) {
    const status = String(input.status).toUpperCase();
    if (!STATUSES.includes(status)) throw AppError.validation('Invalid status');
    doc.status = status;
  }
  if (input.assignedTo !== undefined) doc.assignedTo = plain(input.assignedTo, 160);
  if (input.adminNotes !== undefined) doc.adminNotes = plain(input.adminNotes, 4000);
  if (input.reply) {
    const message = plain(input.reply, 2000);
    if (message.length < 2) throw AppError.validation('Enter a customer-visible reply');
    doc.replies.push({ at: new Date(), actorName, message });
  }
  doc.activity.push({
    at: new Date(),
    actorName,
    action: input.reply ? 'REPLIED' : 'UPDATED',
    fromStatus: from,
    toStatus: doc.status,
    note: input.reply ? 'Customer-visible reply' : 'Staff update',
  });
  await doc.save();
  return presentAdmin(doc.toObject());
}

async function listForApl(query = {}) {
  const filter = {};
  if (query.dsaId) filter.dsaId = query.dsaId;
  if (query.status && STATUSES.includes(String(query.status).toUpperCase())) filter.status = String(query.status).toUpperCase();
  const rows = await SupportRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return { requests: rows.map(presentAdmin) };
}

module.exports = {
  createSupportRequest,
  listForCustomer,
  listForDsa,
  getForDsa,
  updateForDsa,
  listForApl,
  CATEGORIES,
  SERVICES,
  STATUSES,
};
