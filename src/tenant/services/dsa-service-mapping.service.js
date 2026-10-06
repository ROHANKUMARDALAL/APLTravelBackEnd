'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const Dsa = require('../models/Dsa');
const Service = require('../models/Service');
const DsaService = require('../models/DsaService');
const { isServiceOffered } = require('./service-offer.service');

function assertObjectId(value, field) {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
}

/**
 * Create or update a DSA↔Service mapping.
 * APLAdmin should primarily set isAllowedByAPL; isActiveByDSA is DSAAdmin-owned.
 */
async function upsertDsaServiceMapping({
  dsaId,
  serviceId,
  serviceCode,
  isAllowedByAPL,
  isActiveByDSA,
  displayOrder,
  preserveDsaActive = false,
}) {
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

  const existing = await DsaService.findOne({
    dsaId: dsa._id,
    serviceId: service._id,
  });

  const allowed =
    isAllowedByAPL === undefined
      ? existing
        ? existing.isAllowedByAPL
        : false
      : Boolean(isAllowedByAPL);

  let active;
  if (isActiveByDSA !== undefined) {
    active = Boolean(isActiveByDSA);
  } else if (preserveDsaActive && existing) {
    active = existing.isActiveByDSA;
  } else if (existing) {
    active = existing.isActiveByDSA;
  } else {
    active = false;
  }

  // DSA cannot keep a service active if APL has not allowed it.
  if (!allowed) active = false;

  try {
    return await DsaService.findOneAndUpdate(
      { dsaId: dsa._id, serviceId: service._id },
      {
        $set: {
          isAllowedByAPL: allowed,
          isActiveByDSA: active,
          ...(displayOrder !== undefined
            ? {
                displayOrder:
                  displayOrder === null ? null : Number(displayOrder),
              }
            : {}),
        },
        $setOnInsert: {
          dsaId: dsa._id,
          serviceId: service._id,
        },
      },
      { new: true, upsert: true, runValidators: true },
    );
  } catch (error) {
    if (error && error.code === 11000) {
      throw AppError.validation('Duplicate DSA service mapping', [
        { dsaId: String(dsa._id), serviceId: String(service._id) },
      ]);
    }
    throw error;
  }
}

async function setServiceAllowedByApl({
  dsaId,
  serviceId,
  serviceCode,
  isAllowedByAPL,
  displayOrder,
}) {
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

  const mapping = await upsertDsaServiceMapping({
    dsaId,
    serviceId: service._id,
    isAllowedByAPL,
    displayOrder,
    preserveDsaActive: true,
  });

  return { mapping, dsa, service };
}

async function listMappingsForDsa(dsaId) {
  assertObjectId(dsaId, 'dsaId');
  return DsaService.find({ dsaId }).lean();
}

/**
 * Full catalogue view for a DSA: every master service + mapping + offer result.
 */
async function listDsaServiceCatalogue(dsaId) {
  assertObjectId(dsaId, 'dsaId');
  const dsa = await Dsa.findById(dsaId).lean();
  if (!dsa) throw AppError.notFound('DSA not found');

  const [services, mappings] = await Promise.all([
    Service.find({}).sort({ displayOrder: 1, name: 1 }).lean(),
    DsaService.find({ dsaId: dsa._id }).lean(),
  ]);
  const mappingByService = new Map(
    mappings.map((row) => [String(row.serviceId), row]),
  );

  return {
    dsa: {
      id: String(dsa._id),
      dsaCode: dsa.dsaCode,
      companyName: dsa.companyName,
      displayName: dsa.displayName,
      status: dsa.status,
    },
    services: services.map((service) => {
      const mapping = mappingByService.get(String(service._id)) || null;
      const offered = isServiceOffered({ dsa, service, mapping });
      return {
        service: {
          id: String(service._id),
          code: service.code,
          name: service.name,
          slug: service.slug,
          globalStatus: service.globalStatus,
          displayOrder: service.displayOrder,
        },
        mapping: mapping
          ? {
              id: String(mapping._id),
              isAllowedByAPL: mapping.isAllowedByAPL,
              isActiveByDSA: mapping.isActiveByDSA,
              displayOrder: mapping.displayOrder,
            }
          : {
              id: null,
              isAllowedByAPL: false,
              isActiveByDSA: false,
              displayOrder: null,
            },
        effectiveOffered: offered,
      };
    }),
  };
}

module.exports = {
  upsertDsaServiceMapping,
  setServiceAllowedByApl,
  listMappingsForDsa,
  listDsaServiceCatalogue,
};
