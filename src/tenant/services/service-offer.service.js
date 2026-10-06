'use strict';

const { Types } = require('mongoose');
const { isServiceOffered } = require('@apl/shared-domain');
const { AppError } = require('../../common/errors/app-error');
const Dsa = require('../models/Dsa');
const Service = require('../models/Service');
const DsaService = require('../models/DsaService');

/**
 * DB-backed wrappers around the canonical pure rule in @apl/shared-domain.
 * offered =
 *   Service.globalStatus === ACTIVE
 *   AND Dsa.status === ACTIVE
 *   AND DsaService.isAllowedByAPL === true
 *   AND DsaService.isActiveByDSA === true
 */

function assertObjectId(value, field) {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
  return value;
}

/**
 * Load documents and evaluate whether a service is offered for a DSA.
 */
async function evaluateServiceOffer({ dsaId, serviceId, serviceCode }) {
  assertObjectId(dsaId, 'dsaId');

  const dsa = await Dsa.findById(dsaId).lean();
  if (!dsa) throw AppError.notFound('DSA not found');

  let service = null;
  if (serviceId) {
    assertObjectId(serviceId, 'serviceId');
    service = await Service.findById(serviceId).lean();
  } else if (serviceCode) {
    service = await Service.findOne({
      code: String(serviceCode).trim().toLowerCase(),
    }).lean();
  } else {
    throw AppError.validation('serviceId or serviceCode is required');
  }
  if (!service) throw AppError.notFound('Service not found');

  const mapping = await DsaService.findOne({
    dsaId: dsa._id,
    serviceId: service._id,
  }).lean();

  const offered = isServiceOffered({ dsa, service, mapping });
  return {
    offered,
    reason: offered
      ? 'OFFERED'
      : !mapping
        ? 'NO_MAPPING'
        : String(service.globalStatus).toUpperCase() !== 'ACTIVE'
          ? 'SERVICE_GLOBALLY_INACTIVE'
          : String(dsa.status).toUpperCase() !== 'ACTIVE'
            ? 'DSA_INACTIVE'
            : mapping.isAllowedByAPL !== true
              ? 'NOT_ALLOWED_BY_APL'
              : mapping.isActiveByDSA !== true
                ? 'NOT_ACTIVE_BY_DSA'
                : 'UNAVAILABLE',
    dsa: {
      id: String(dsa._id),
      dsaCode: dsa.dsaCode,
      status: dsa.status,
    },
    service: {
      id: String(service._id),
      code: service.code,
      name: service.name,
      globalStatus: service.globalStatus,
    },
    mapping: mapping
      ? {
          id: String(mapping._id),
          isAllowedByAPL: mapping.isAllowedByAPL,
          isActiveByDSA: mapping.isActiveByDSA,
          displayOrder: mapping.displayOrder,
        }
      : null,
  };
}

/**
 * List offered services for a DSA (for future public/DSAAdmin use).
 */
async function listOfferedServicesForDsa(dsaId) {
  assertObjectId(dsaId, 'dsaId');
  const dsa = await Dsa.findById(dsaId).lean();
  if (!dsa) throw AppError.notFound('DSA not found');
  if (String(dsa.status).toUpperCase() !== 'ACTIVE') return [];

  const mappings = await DsaService.find({
    dsaId: dsa._id,
    isAllowedByAPL: true,
    isActiveByDSA: true,
  }).lean();
  if (!mappings.length) return [];

  const serviceIds = mappings.map((row) => row.serviceId);
  const services = await Service.find({
    _id: { $in: serviceIds },
    globalStatus: 'ACTIVE',
  })
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  const byId = new Map(services.map((svc) => [String(svc._id), svc]));
  return mappings
    .map((mapping) => {
      const service = byId.get(String(mapping.serviceId));
      if (!service) return null;
      if (!isServiceOffered({ dsa, service, mapping })) return null;
      return {
        code: service.code,
        name: service.name,
        slug: service.slug,
        icon: service.icon,
        displayOrder:
          mapping.displayOrder == null ? service.displayOrder : mapping.displayOrder,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

module.exports = {
  isServiceOffered,
  evaluateServiceOffer,
  listOfferedServicesForDsa,
};
