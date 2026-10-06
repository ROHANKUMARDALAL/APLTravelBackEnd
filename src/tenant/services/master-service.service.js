'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Service = require('../models/Service');
const { SERVICE_GLOBAL_STATUSES } = require('../models/Service');

function assertObjectId(value, field = 'id') {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
}

function toPublicService(svc) {
  if (!svc) return null;
  return {
    id: String(svc._id),
    code: svc.code,
    name: svc.name,
    slug: svc.slug,
    description: svc.description || '',
    icon: svc.icon || '',
    globalStatus: svc.globalStatus,
    displayOrder: svc.displayOrder,
    createdAt: svc.createdAt,
    updatedAt: svc.updatedAt,
  };
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function listMasterServices({ globalStatus } = {}) {
  const filter = {};
  if (globalStatus) filter.globalStatus = String(globalStatus).toUpperCase();
  return Service.find(filter).sort({ displayOrder: 1, name: 1 }).lean();
}

async function getMasterServiceByCode(code) {
  const service = await Service.findOne({
    code: String(code || '')
      .trim()
      .toLowerCase(),
  }).lean();
  if (!service) throw AppError.notFound('Service not found');
  return service;
}

async function getMasterServiceById(serviceId) {
  assertObjectId(serviceId, 'serviceId');
  const service = await Service.findById(serviceId).lean();
  if (!service) throw AppError.notFound('Service not found');
  return service;
}

async function createMasterService(input = {}) {
  const code = String(input.code || '')
    .trim()
    .toLowerCase();
  const name = String(input.name || '').trim();
  if (!code) throw AppError.validation('code is required');
  if (!/^[a-z][a-z0-9_-]*$/.test(code)) {
    throw AppError.validation('Invalid service code format');
  }
  if (!name) throw AppError.validation('name is required');

  const slug = slugify(input.slug || name || code);
  if (!slug) throw AppError.validation('slug is required');

  const globalStatus = String(input.globalStatus || 'ACTIVE').toUpperCase();
  if (!SERVICE_GLOBAL_STATUSES.includes(globalStatus)) {
    throw AppError.validation('Invalid globalStatus');
  }

  try {
    return await Service.create({
      code,
      name,
      slug,
      description: String(input.description || '').trim(),
      icon: String(input.icon || '').trim(),
      globalStatus,
      displayOrder:
        input.displayOrder === undefined || input.displayOrder === null
          ? 100
          : Number(input.displayOrder),
    });
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Service code or slug already exists', [
        { code: 'DUPLICATE_KEY', keyValue: error.keyValue },
      ]);
    }
    throw error;
  }
}

async function updateMasterService(serviceId, input = {}) {
  assertObjectId(serviceId, 'serviceId');
  const service = await Service.findById(serviceId);
  if (!service) throw AppError.notFound('Service not found');

  // Stable codes must not be renamed once created.
  if (input.code !== undefined && String(input.code).trim().toLowerCase() !== service.code) {
    throw AppError.validation('Service code cannot be changed after creation');
  }

  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) throw AppError.validation('name is required');
    service.name = name;
  }
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    if (!slug) throw AppError.validation('slug is required');
    service.slug = slug;
  }
  if (input.description !== undefined) {
    service.description = String(input.description || '').trim();
  }
  if (input.icon !== undefined) {
    service.icon = String(input.icon || '').trim();
  }
  if (input.globalStatus !== undefined) {
    const globalStatus = String(input.globalStatus).toUpperCase();
    if (!SERVICE_GLOBAL_STATUSES.includes(globalStatus)) {
      throw AppError.validation('Invalid globalStatus');
    }
    service.globalStatus = globalStatus;
  }
  if (input.displayOrder !== undefined) {
    service.displayOrder = Number(input.displayOrder);
  }

  try {
    await service.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Service slug already exists', [
        { code: 'DUPLICATE_KEY', keyValue: error.keyValue },
      ]);
    }
    throw error;
  }

  return service;
}

module.exports = {
  listMasterServices,
  getMasterServiceByCode,
  getMasterServiceById,
  createMasterService,
  updateMasterService,
  toPublicService,
};
