'use strict';

const { AppError } = require('../../common/errors/app-error');
const Dsa = require('../../tenant/models/Dsa');
const {
  toPublicDsa,
  updateDsa,
} = require('../../tenant/services/dsa.service');
const {
  listDsaServiceCatalogue,
  upsertDsaServiceMapping,
} = require('../../tenant/services/dsa-service-mapping.service');
function availabilityLabel({ service, mapping, offered }) {
  if (String(service.globalStatus).toUpperCase() !== 'ACTIVE') {
    return {
      code: 'GLOBALLY_DISABLED',
      label: 'Globally disabled',
      reason: 'APL has deactivated this service platform-wide.',
    };
  }
  if (!mapping || mapping.isAllowedByAPL !== true) {
    return {
      code: 'NOT_ALLOWED',
      label: 'Not allowed by APL',
      reason: 'APLAdmin has not granted this service to your DSA.',
    };
  }
  if (mapping.isActiveByDSA !== true) {
    return {
      code: 'INACTIVE',
      label: 'Inactive',
      reason: 'Allowed by APL, but not activated for your portal.',
    };
  }
  if (offered) {
    return {
      code: 'ACTIVE',
      label: 'Active',
      reason: 'Service is offered on your portal.',
    };
  }
  return {
    code: 'UNAVAILABLE',
    label: 'Unavailable',
    reason: 'Service is currently unavailable.',
  };
}

async function getTenantProfile(dsaId) {
  const dsa = await Dsa.findById(dsaId).lean();
  if (!dsa) throw AppError.notFound('DSA not found');
  return toPublicDsa(dsa);
}

/**
 * DSAAdmin may edit contact/display fields only — never dsaCode or status.
 */
async function updateTenantProfile(dsaId, input = {}) {
  const allowed = {
    companyName: input.companyName,
    displayName: input.displayName,
    ownerName: input.ownerName,
    email: input.email,
    phone: input.phone,
    address: input.address,
    domain: input.domain,
    subdomain: input.subdomain,
  };

  // Strip undefined so updateDsa keeps existing values.
  Object.keys(allowed).forEach((key) => {
    if (allowed[key] === undefined) delete allowed[key];
  });

  if (input.status !== undefined || input.dsaCode !== undefined) {
    throw AppError.forbidden(
      'DSAAdmin cannot change platform status or dsaCode',
    );
  }

  const dsa = await updateDsa(dsaId, allowed);
  return toPublicDsa(dsa.toObject ? dsa.toObject() : dsa);
}

async function getTenantServiceCatalogue(dsaId) {
  const catalogue = await listDsaServiceCatalogue(dsaId);
  return {
    dsa: catalogue.dsa,
    services: catalogue.services.map((row) => {
      const offered = row.effectiveOffered;
      const availability = availabilityLabel({
        service: row.service,
        mapping: row.mapping,
        offered,
      });
      return {
        ...row,
        effectiveOffered: offered,
        availability,
        canToggleActive:
          row.mapping.isAllowedByAPL === true &&
          String(row.service.globalStatus).toUpperCase() === 'ACTIVE' &&
          String(catalogue.dsa.status).toUpperCase() === 'ACTIVE',
      };
    }),
  };
}

async function setTenantServiceActive(dsaId, serviceId, isActiveByDSA) {
  const catalogue = await listDsaServiceCatalogue(dsaId);
  const row = catalogue.services.find(
    (item) => String(item.service.id) === String(serviceId),
  );
  if (!row) throw AppError.notFound('Service not found');

  if (String(catalogue.dsa.status).toUpperCase() !== 'ACTIVE') {
    throw AppError.forbidden('DSA tenant is not active');
  }

  const wantActive = Boolean(isActiveByDSA);

  if (wantActive) {
    if (String(row.service.globalStatus).toUpperCase() !== 'ACTIVE') {
      throw AppError.forbidden('Service is globally disabled');
    }
    if (row.mapping.isAllowedByAPL !== true) {
      throw AppError.forbidden(
        'Service is not allowed by APL and cannot be activated',
      );
    }
  }

  const mapping = await upsertDsaServiceMapping({
    dsaId,
    serviceId,
    isAllowedByAPL: row.mapping.isAllowedByAPL === true,
    isActiveByDSA: wantActive,
    preserveDsaActive: false,
  });

  // Reload for offer evaluation
  const refreshed = await getTenantServiceCatalogue(dsaId);
  const next = refreshed.services.find(
    (item) => String(item.service.id) === String(serviceId),
  );

  return {
    mapping: {
      id: String(mapping._id),
      isAllowedByAPL: mapping.isAllowedByAPL,
      isActiveByDSA: mapping.isActiveByDSA,
    },
    service: next,
  };
}

async function getTenantDashboard(dsaId) {
  const profile = await getTenantProfile(dsaId);
  const catalogue = await getTenantServiceCatalogue(dsaId);

  const allowed = catalogue.services.filter((s) => s.mapping.isAllowedByAPL);
  const active = catalogue.services.filter(
    (s) => s.mapping.isAllowedByAPL && s.mapping.isActiveByDSA,
  );
  const offered = catalogue.services.filter((s) => s.effectiveOffered);
  const unavailable = catalogue.services.filter((s) => !s.effectiveOffered);

  return {
    dsa: profile,
    stats: {
      allowedByApl: allowed.length,
      activeByDsa: active.length,
      effectivelyOffered: offered.length,
      unavailable: unavailable.length,
    },
    services: catalogue.services.map((row) => ({
      id: row.service.id,
      code: row.service.code,
      name: row.service.name,
      globalStatus: row.service.globalStatus,
      isAllowedByAPL: row.mapping.isAllowedByAPL,
      isActiveByDSA: row.mapping.isActiveByDSA,
      effectiveOffered: row.effectiveOffered,
      availability: row.availability,
    })),
    websiteStatus: {
      note: 'CMS, branding, and footer management arrive in Phase 7.',
      modules: [
        { item: 'Blogs', value: 'Phase 7' },
        { item: 'Testimonials', value: 'Phase 7' },
        { item: 'CMS pages', value: 'Phase 7' },
        { item: 'Branding / Footer', value: 'Phase 7' },
      ],
    },
  };
}

module.exports = {
  getTenantProfile,
  updateTenantProfile,
  getTenantServiceCatalogue,
  setTenantServiceActive,
  getTenantDashboard,
  availabilityLabel,
};
