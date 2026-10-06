'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Dsa = require('../models/Dsa');
const DsaService = require('../models/DsaService');
const { allocateDsaCode } = require('./dsa-code.service');
const { DSA_STATUSES } = require('../models/Dsa');

function assertObjectId(value, field = 'id') {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
}

function toPublicDsa(dsa, extras = {}) {
  if (!dsa) return null;
  return {
    id: String(dsa._id),
    dsaCode: dsa.dsaCode,
    companyName: dsa.companyName,
    displayName: dsa.displayName,
    ownerName: dsa.ownerName,
    email: dsa.email,
    phone: dsa.phone,
    address: dsa.address || {},
    domain: dsa.domain || '',
    subdomain: dsa.subdomain || '',
    status: dsa.status,
    createdAt: dsa.createdAt,
    updatedAt: dsa.updatedAt,
    ...extras,
  };
}

function normalizeAddress(input = {}) {
  return {
    line1: String(input.line1 || '').trim(),
    line2: String(input.line2 || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim(),
    postalCode: String(input.postalCode || '').trim(),
    country: String(input.country || '').trim(),
  };
}

/** Normalize stored custom domain (no protocol/path; no www; no port except localhost). */
function normalizeDomainValue(value) {
  const { normalizeHost } = require('../../public-site/utils/host');
  return normalizeHost(value);
}

function normalizeSubdomainValue(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!raw) return '';
  if (raw.length > 63) {
    throw AppError.validation('subdomain is too long');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(raw)) {
    throw AppError.validation('Invalid subdomain format');
  }
  return raw;
}

async function assertHostFieldsAvailable({ domain, subdomain, excludeId }) {
  if (domain) {
    const conflict = await Dsa.findOne({
      domain,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean();
    if (conflict) {
      throw AppError.validation('Domain already in use by another DSA');
    }
  }
  if (subdomain) {
    const conflict = await Dsa.findOne({
      subdomain,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean();
    if (conflict) {
      throw AppError.validation('Subdomain already in use by another DSA');
    }
  }
}

function normalizeCreateInput(input = {}) {
  const companyName = String(input.companyName || '').trim();
  const displayName = String(input.displayName || companyName).trim();
  const ownerName = String(input.ownerName || '').trim();
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const phone = String(input.phone || '').trim();
  if (!companyName) throw AppError.validation('companyName is required');
  if (!ownerName) throw AppError.validation('ownerName is required');
  if (!email || !email.includes('@')) {
    throw AppError.validation('Valid email is required');
  }
  if (!phone) throw AppError.validation('phone is required');

  const status = String(input.status || 'ACTIVE').toUpperCase();
  if (!DSA_STATUSES.includes(status)) {
    throw AppError.validation('Invalid DSA status', [{ status }]);
  }

  return {
    companyName,
    displayName,
    ownerName,
    email,
    phone,
    address: normalizeAddress(input.address),
    domain: normalizeDomainValue(input.domain),
    subdomain: normalizeSubdomainValue(input.subdomain),
    status,
    config: input.config,
  };
}

async function createDsa(input) {
  const payload = normalizeCreateInput(input);
  await assertHostFieldsAvailable({
    domain: payload.domain,
    subdomain: payload.subdomain,
  });
  const dsaCode = await allocateDsaCode();
  try {
    return await Dsa.create({ ...payload, dsaCode });
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('DSA unique field conflict', [
        { code: 'DUPLICATE_KEY', keyValue: error.keyValue },
      ]);
    }
    throw error;
  }
}

async function listDsasPaginated({
  status,
  q,
  page = 1,
  pageSize = 20,
} = {}) {
  const filter = {};
  if (status) {
    const normalized = String(status).toUpperCase();
    if (!DSA_STATUSES.includes(normalized)) {
      throw AppError.validation('Invalid status filter');
    }
    filter.status = normalized;
  }

  const query = String(q || '').trim();
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { companyName: rx },
      { displayName: rx },
      { ownerName: rx },
      { email: rx },
      { dsaCode: rx },
      { subdomain: rx },
      { domain: rx },
    ];
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const skip = (safePage - 1) * safeSize;

  const [total, rows] = await Promise.all([
    Dsa.countDocuments(filter),
    Dsa.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeSize).lean(),
  ]);

  const ids = rows.map((row) => row._id);
  const allowedCounts = await DsaService.aggregate([
    {
      $match: {
        dsaId: { $in: ids },
        isAllowedByAPL: true,
      },
    },
    { $group: { _id: '$dsaId', count: { $sum: 1 } } },
  ]);
  const countByDsa = new Map(
    allowedCounts.map((row) => [String(row._id), row.count]),
  );

  return {
    items: rows.map((dsa) =>
      toPublicDsa(dsa, {
        allowedServiceCount: countByDsa.get(String(dsa._id)) || 0,
      }),
    ),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / safeSize)),
    },
  };
}

async function listDsas({ status } = {}) {
  const filter = {};
  if (status) filter.status = String(status).toUpperCase();
  return Dsa.find(filter).sort({ createdAt: -1 }).lean();
}

async function getDsaById(dsaId) {
  assertObjectId(dsaId, 'dsaId');
  const dsa = await Dsa.findById(dsaId).lean();
  if (!dsa) throw AppError.notFound('DSA not found');
  return dsa;
}

async function updateDsa(dsaId, input = {}) {
  assertObjectId(dsaId, 'dsaId');
  const dsa = await Dsa.findById(dsaId);
  if (!dsa) throw AppError.notFound('DSA not found');

  // dsaCode is immutable after creation.
  if (input.companyName !== undefined) {
    const companyName = String(input.companyName || '').trim();
    if (!companyName) throw AppError.validation('companyName is required');
    dsa.companyName = companyName;
  }
  if (input.displayName !== undefined) {
    const displayName = String(input.displayName || '').trim();
    if (!displayName) throw AppError.validation('displayName is required');
    dsa.displayName = displayName;
  }
  if (input.ownerName !== undefined) {
    const ownerName = String(input.ownerName || '').trim();
    if (!ownerName) throw AppError.validation('ownerName is required');
    dsa.ownerName = ownerName;
  }
  if (input.email !== undefined) {
    const email = String(input.email || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) {
      throw AppError.validation('Valid email is required');
    }
    dsa.email = email;
  }
  if (input.phone !== undefined) {
    const phone = String(input.phone || '').trim();
    if (!phone) throw AppError.validation('phone is required');
    dsa.phone = phone;
  }
  if (input.address !== undefined) {
    dsa.address = normalizeAddress(input.address);
  }
  if (input.domain !== undefined) {
    dsa.domain = normalizeDomainValue(input.domain);
  }
  if (input.subdomain !== undefined) {
    dsa.subdomain = normalizeSubdomainValue(input.subdomain);
  }

  await assertHostFieldsAvailable({
    domain: dsa.domain,
    subdomain: dsa.subdomain,
    excludeId: dsa._id,
  });

  try {
    await dsa.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('DSA unique field conflict', [
        { code: 'DUPLICATE_KEY', keyValue: error.keyValue },
      ]);
    }
    throw error;
  }

  return dsa;
}

async function setDsaStatus(dsaId, status) {
  assertObjectId(dsaId, 'dsaId');
  const next = String(status || '').toUpperCase();
  if (!DSA_STATUSES.includes(next)) {
    throw AppError.validation('Invalid DSA status', [{ status }]);
  }
  const dsa = await Dsa.findById(dsaId);
  if (!dsa) throw AppError.notFound('DSA not found');
  const previousStatus = dsa.status;
  dsa.status = next;
  await dsa.save();
  return { dsa, previousStatus };
}

module.exports = {
  createDsa,
  listDsas,
  listDsasPaginated,
  getDsaById,
  updateDsa,
  setDsaStatus,
  toPublicDsa,
  normalizeCreateInput,
  DSA_STATUSES,
};
