'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { requireLogin } = require('../../common/middleware/require-login');
const { sendSuccess } = require('../../common/response/envelope');
const { AppError } = require('../../common/errors/app-error');
const SavedTraveller = require('../models/SavedTraveller');

const router = express.Router();

function toPublic(doc) {
  return {
    id: String(doc._id),
    title: doc.title || 'Mr',
    firstName: doc.firstName,
    lastName: doc.lastName,
    dateOfBirth: doc.dateOfBirth || '',
    gender: doc.gender || '',
    nationality: doc.nationality || '',
    travellerType: doc.travellerType || 'adult',
    passportNumber: doc.passportNumber || '',
    passportIssueDate: doc.passportIssueDate || '',
    passportExpiry: doc.passportExpiry || '',
    passportIssueCountry: doc.passportIssueCountry || '',
  };
}

function readFields(body) {
  const firstName = String(body?.firstName || '').trim();
  const lastName = String(body?.lastName || '').trim();
  if (!firstName || !lastName) {
    throw AppError.validation('First name and last name are required');
  }
  const rawType = String(body?.travellerType || 'adult').toLowerCase();
  const travellerType = ['adult', 'child', 'infant'].includes(rawType) ? rawType : 'adult';
  return {
    title: String(body?.title || 'Mr').trim() || 'Mr',
    firstName,
    lastName,
    dateOfBirth: String(body?.dateOfBirth || '').trim(),
    gender: String(body?.gender || '').trim(),
    nationality: String(body?.nationality || '').trim(),
    travellerType,
    passportNumber: String(body?.passportNumber || '').trim(),
    passportIssueDate: String(body?.passportIssueDate || '').trim(),
    passportExpiry: String(body?.passportExpiry || '').trim(),
    passportIssueCountry: String(body?.passportIssueCountry || '').trim(),
  };
}

async function findOwned(userId, id, dsaId) {
  if (!mongoose.isValidObjectId(id)) throw AppError.notFound('Traveller not found');
  const filter = { _id: id, userId };
  if (dsaId) filter.dsaId = dsaId;
  const doc = await SavedTraveller.findOne(filter);
  if (!doc) throw AppError.notFound('Traveller not found');
  return doc;
}

router.get(
  '/',
  requireLogin,
  asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.customerDsaId) filter.dsaId = req.customerDsaId;
    const rows = await SavedTraveller.find(filter).sort({ updatedAt: -1 });
    return sendSuccess(res, { travellers: rows.map(toPublic) });
  }),
);

router.post(
  '/',
  requireLogin,
  asyncHandler(async (req, res) => {
    const fields = readFields(req.body);
    let doc = null;
    if (req.body?.id) {
      doc = await findOwned(req.user._id, req.body.id, req.customerDsaId);
    } else {
      doc = await SavedTraveller.findOne({
        userId: req.user._id,
        firstName: new RegExp(`^${fields.firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        lastName: new RegExp(`^${fields.lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        dateOfBirth: fields.dateOfBirth,
      });
    }
    if (doc) {
      Object.assign(doc, fields);
      await doc.save();
    } else {
      doc = await SavedTraveller.create({
        userId: req.user._id,
        dsaId: req.customerDsaId || undefined,
        ...fields,
      });
    }
    return sendSuccess(res, { traveller: toPublic(doc) });
  }),
);

router.patch(
  '/:id',
  requireLogin,
  asyncHandler(async (req, res) => {
    const doc = await findOwned(req.user._id, req.params.id, req.customerDsaId);
    Object.assign(doc, readFields({ ...toPublic(doc), ...req.body }));
    await doc.save();
    return sendSuccess(res, { traveller: toPublic(doc) });
  }),
);

router.delete(
  '/:id',
  requireLogin,
  asyncHandler(async (req, res) => {
    const doc = await findOwned(req.user._id, req.params.id, req.customerDsaId);
    await doc.deleteOne();
    return sendSuccess(res, { id: String(doc._id) });
  }),
);

module.exports = router;
