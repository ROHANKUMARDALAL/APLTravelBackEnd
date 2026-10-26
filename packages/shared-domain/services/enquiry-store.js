'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { Enquiry } = require('../models');
const { ENQUIRY_STATUSES } = require('../constants/services');
const { encryptField, decryptField, maskDocument } = require('../security/document-crypto');
const { validateHolidayEnquiry, validateServiceEnquiry } = require('../rules/holiday-enquiry');
const { packageSnapshot } = require('./holiday-package');
const { DomainError } = require('./domain-error');

const RETENTION_MS = 1000 * 60 * 60 * 24 * 730;

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function encryptPassengers(passengers) {
  return (passengers || []).map((row) => ({
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth || '',
    age: row.age,
    gender: row.gender || '',
    nationality: row.nationality || '',
    document: {
      type: row.document?.type || '',
      numberEnc: encryptField(row.document?.number),
      holderName: row.document?.holderName || '',
      nationality: row.document?.nationality || '',
      dateOfBirth: row.document?.dateOfBirth || '',
      expiryDate: row.document?.expiryDate || '',
      issuingCountry: row.document?.issuingCountry || '',
    },
  }));
}

async function applyRetention(doc) {
  if (!doc?.retentionDeleteAfter || doc.retentionDeleteAfter > new Date()) return doc;
  let changed = false;
  for (const passenger of doc.passengers || []) {
    if (passenger.document?.numberEnc) {
      passenger.document.numberEnc = '';
      changed = true;
    }
  }
  if (changed) await doc.save();
  return doc;
}

function presentPassenger(passenger, { reveal }) {
  const stored = passenger.document?.numberEnc || '';
  let masked = '';
  if (stored) {
    try {
      masked = maskDocument(decryptField(stored));
    } catch {
      masked = '****';
    }
  }
  const document = {
    type: passenger.document?.type || '',
    maskedNumber: masked,
    holderName: passenger.document?.holderName || '',
    nationality: passenger.document?.nationality || '',
    dateOfBirth: passenger.document?.dateOfBirth || '',
    expiryDate: passenger.document?.expiryDate || '',
    issuingCountry: passenger.document?.issuingCountry || '',
  };
  if (reveal && stored) {
    try {
      document.number = decryptField(stored);
    } catch {
      document.number = '';
    }
  }
  return {
    fullName: passenger.fullName,
    dateOfBirth: passenger.dateOfBirth || '',
    age: passenger.age,
    gender: passenger.gender || '',
    nationality: passenger.nationality || '',
    document,
  };
}

function presentEnquiry(doc, { reveal = false, includeInternal = false } = {}) {
  const row = doc.toObject ? doc.toObject() : doc;
  const view = {
    id: String(row._id),
    enquiryReference: row.enquiryReference,
    dsaId: String(row.dsaId),
    serviceCode: row.serviceCode,
    enquiryCategory: row.enquiryCategory === 'GROUP_DEPARTURE' ? 'GROUP_DEPARTURE' : (row.enquiryCategory || ''),
    customerId: String(row.customerId),
    customerMembershipId: row.customerMembershipId ? String(row.customerMembershipId) : '',
    customer: row.customerSnapshot || {},
    holidayPackageId: row.holidayPackageId ? String(row.holidayPackageId) : '',
    package: row.holidayPackageSnapshot || null,
    preferredDepartureDate: row.preferredDepartureDate || '',
    durationDays: row.durationDays || 0,
    adults: row.adults || 0,
    children: row.children || 0,
    totalPassengers: row.totalPassengers || 0,
    passengers: (row.passengers || []).map((passenger) => presentPassenger(passenger, { reveal })),
    contactDetails: row.contactDetails || {},
    specialRequirements: row.specialRequirements || '',
    status: row.status,
    assignedTo: row.assignedTo || '',
    customerVisibleRemarks: row.customerVisibleRemarks || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (includeInternal) {
    view.adminNotes = row.adminNotes || '';
    view.activity = row.activity || [];
    view.retentionDeleteAfter = row.retentionDeleteAfter || null;
  }
  return view;
}

async function findIdempotent({ dsaId, customerId, idempotencyKey }) {
  if (!idempotencyKey) return null;
  return Enquiry.findOne({ dsaId, customerId, idempotencyKey });
}

async function submitEnquiry({
  dsaId,
  serviceCode,
  customer,
  membership,
  packageDoc,
  body,
}) {
  const code = clean(serviceCode, 40).toLowerCase();
  if (!customer?.id) throw new DomainError('Login is required', 401);
  if (!membership?.id) throw new DomainError('Your account is not registered on this website', 403);
  const existing = await findIdempotent({
    dsaId,
    customerId: customer.id,
    idempotencyKey: clean(body?.idempotencyKey, 80),
  });
  if (existing) return { enquiry: presentEnquiry(existing), created: false };

  let validated;
  let snapshot = null;
  let packageId = null;
  if (code === 'holiday') {
    if (!packageDoc || String(packageDoc.dsaId) !== String(dsaId)) {
      throw new DomainError('Holiday package not found', 404);
    }
    if (packageDoc.status !== 'PUBLISHED' || packageDoc.enquiryEnabled === false) {
      throw new DomainError('This package is not open for enquiries', 400);
    }
    validated = validateHolidayEnquiry(body, { isInternational: packageDoc.isInternational === true });
    snapshot = packageSnapshot(packageDoc);
    packageId = packageDoc._id || packageDoc.id;
  } else {
    validated = validateServiceEnquiry(body);
  }
  if (!validated.ok) throw new DomainError('Check the enquiry details', 400, validated.errors);
  if (!validated.value.idempotencyKey) {
    throw new DomainError('idempotencyKey is required', 400, [{ field: 'idempotencyKey' }]);
  }

  const reference = `APL-ENQ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    const created = await Enquiry.create({
      enquiryReference: reference,
      dsaId,
      serviceCode: code,
      customerId: customer.id,
      customerMembershipId: membership.id,
      customerSnapshot: {
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        customerCode: membership.customerCode || '',
      },
      holidayPackageId: packageId,
      holidayPackageSnapshot: snapshot,
      ...validated.value,
      enquiryCategory: code === 'holiday' && packageDoc.packageCategory === 'GROUP_DEPARTURE' ? 'GROUP_DEPARTURE' : (code === 'holiday' ? 'HOLIDAY' : ''),
      passengers: encryptPassengers(validated.value.passengers),
      status: 'NEW',
      retentionDeleteAfter: new Date(Date.now() + RETENTION_MS),
      activity: [
        {
          at: new Date(),
          actorId: String(customer.id),
          actorName: customer.name || '',
          action: 'created',
          toStatus: 'NEW',
          note: 'Enquiry submitted',
        },
      ],
    });
    return { enquiry: presentEnquiry(created), created: true };
  } catch (error) {
    if (error && error.code === 11000) {
      const again = await findIdempotent({
        dsaId,
        customerId: customer.id,
        idempotencyKey: validated.value.idempotencyKey,
      });
      if (again) return { enquiry: presentEnquiry(again), created: false };
    }
    throw error;
  }
}

function asObjectId(value) {
  if (!value) return value;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : value;
}

function buildAdminFilter({ dsaId, query = {} }) {
  const filter = {};
  if (dsaId) filter.dsaId = asObjectId(dsaId);
  else if (query.dsaId && /^[a-f0-9]{24}$/i.test(String(query.dsaId))) filter.dsaId = asObjectId(query.dsaId);
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.serviceCode) filter.serviceCode = String(query.serviceCode).toLowerCase();
  if (query.reference) filter.enquiryReference = clean(query.reference, 40).toUpperCase();
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to))
        ? new Date(`${query.to}T23:59:59.999Z`)
        : new Date(query.to);
      filter.createdAt.$lte = end;
    }
  }
  const clauses = [];
  const addText = (value, fields) => {
    const text = clean(value, 80);
    if (!text) return;
    const pattern = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    clauses.push({ $or: fields.map((field) => ({ [field]: pattern })) });
  };
  addText(query.q, [
    'enquiryReference',
    'customerSnapshot.name',
    'customerSnapshot.phone',
    'customerSnapshot.email',
    'contactDetails.mobile',
    'holidayPackageSnapshot.title',
    'holidayPackageSnapshot.destinationCity',
  ]);
  addText(query.customer, [
    'customerSnapshot.name',
    'customerSnapshot.phone',
    'customerSnapshot.email',
    'contactDetails.name',
    'contactDetails.mobile',
    'contactDetails.email',
  ]);
  addText(query.packageName, ['holidayPackageSnapshot.title']);
  addText(query.destination, ['holidayPackageSnapshot.destinationCity']);
  if (clauses.length === 1) Object.assign(filter, clauses[0]);
  else if (clauses.length > 1) filter.$and = clauses;
  return filter;
}

async function listEnquiries({ dsaId, query = {} }) {
  const filter = buildAdminFilter({ dsaId, query });
  const rows = await Enquiry.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  return rows.map((row) => presentEnquiry(row, { includeInternal: true }));
}

async function enquirySummary({ dsaId, query = {} } = {}) {
  const match = buildAdminFilter({ dsaId, query });
  const grouped = await Enquiry.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(grouped.map((row) => [row._id, row.count]));
  const total = grouped.reduce((sum, row) => sum + row.count, 0);
  return {
    total,
    new: counts.NEW || 0,
    inProgress: (counts.IN_PROGRESS || 0) + (counts.CONTACTED || 0),
    quoted: counts.QUOTED || 0,
    confirmed: counts.CONFIRMED || 0,
    closed: (counts.CLOSED || 0) + (counts.CANCELLED || 0),
  };
}

async function getEnquiry({ dsaId, enquiryId, reference, reveal = false }) {
  const filter = {};
  if (dsaId) filter.dsaId = dsaId;
  if (enquiryId) filter._id = enquiryId;
  if (reference) filter.enquiryReference = clean(reference, 40).toUpperCase();
  const doc = await Enquiry.findOne(filter);
  if (!doc) throw new DomainError('Enquiry not found', 404);
  await applyRetention(doc);
  return presentEnquiry(doc, { reveal, includeInternal: true });
}

async function listCustomerEnquiries({ dsaId, customerId }) {
  const rows = await Enquiry.find({ dsaId, customerId }).sort({ createdAt: -1 }).limit(100);
  const presented = [];
  for (const row of rows) {
    await applyRetention(row);
    const view = presentEnquiry(row, { includeInternal: false });
    delete view.customerId;
    view.timeline = (row.activity || []).map((item) => ({
      at: item.at,
      action: item.action || "updated",
      fromStatus: item.fromStatus || "",
      toStatus: item.toStatus || "",
    }));
    presented.push(view);
  }
  return presented;
}

async function updateEnquiry({ dsaId, enquiryId, actor, patch, allowWorkflow }) {
  if (!allowWorkflow) throw new DomainError('You cannot change this enquiry workflow', 403);
  const filter = { _id: enquiryId };
  if (dsaId) filter.dsaId = dsaId;
  const doc = await Enquiry.findOne(filter);
  if (!doc) throw new DomainError('Enquiry not found', 404);
  const before = doc.status;
  const nextStatus = patch.status ? String(patch.status).toUpperCase() : '';
  if (nextStatus) {
    if (!ENQUIRY_STATUSES.includes(nextStatus)) throw new DomainError('Unsupported enquiry status');
    doc.status = nextStatus;
  }
  if (patch.assignedTo !== undefined) doc.assignedTo = clean(patch.assignedTo, 120);
  if (patch.adminNotes !== undefined) doc.adminNotes = clean(patch.adminNotes, 8000);
  if (patch.customerVisibleRemarks !== undefined) {
    doc.customerVisibleRemarks = clean(patch.customerVisibleRemarks, 4000);
  }
  if (patch.enquiryCategory !== undefined) {
    if (doc.serviceCode !== 'holiday') throw new DomainError('Only holiday enquiries use a package category');
    const category = clean(patch.enquiryCategory, 40).toUpperCase();
    if (!['HOLIDAY', 'GROUP_DEPARTURE'].includes(category)) {
      throw new DomainError('Enquiry category must be HOLIDAY or GROUP_DEPARTURE');
    }
    doc.enquiryCategory = category;
  }
  doc.activity.push({
    at: new Date(),
    actorId: String(actor?.id || ''),
    actorName: actor?.name || actor?.email || '',
    action: 'updated',
    fromStatus: before,
    toStatus: doc.status,
    note: clean(patch.note || 'Enquiry updated', 500),
  });
  await doc.save();
  return presentEnquiry(doc, { includeInternal: true });
}

module.exports = {
  submitEnquiry,
  listEnquiries,
  enquirySummary,
  getEnquiry,
  listCustomerEnquiries,
  updateEnquiry,
  presentEnquiry,
};
