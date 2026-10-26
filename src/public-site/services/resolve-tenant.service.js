'use strict';

const mongoose = require('mongoose');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { config } = require('../../common/config');
const Dsa = require('../../tenant/models/Dsa');
const {
  normalizeHost,
  parseDevHostMap,
  isLocalHost,
  developmentSubdomain,
} = require('../utils/host');

/** Local hosts often include :port; stored Dsa.domain may omit it. */
function domainLookupCandidates(host) {
  const candidates = [host];
  if (host.includes(':')) {
    const hostname = host.split(':')[0];
    if (isLocalHost(hostname)) candidates.push(hostname);
  }
  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Resolve the public DSA tenant from the inbound website host.
 * Never trusts client-supplied dsaId.
 */
function extractRequestHost(req) {
  // Prefer proxy-forwarded host (B2C server / CDN), then Host.
  const forwarded = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const aplPublic = String(req.headers['x-apl-public-host'] || '').trim();
  const hostHeader = String(req.headers.host || '').trim();

  // Dev-only explicit host from B2C when calling local API as localhost:3000.
  if (!config.isProduction && aplPublic) {
    return normalizeHost(aplPublic);
  }
  if (forwarded) return normalizeHost(forwarded);
  return normalizeHost(hostHeader);
}

function assertDatabaseReady() {
  const state = mongoose.connection.readyState;
  if (state === 0 || state === 3) {
    throw new AppError(ErrorCode.DATABASE_UNAVAILABLE, 'Database is not available', {
      httpStatus: 503,
    });
  }
}

async function findDsaByCode(dsaCode) {
  assertDatabaseReady();
  if (!dsaCode) return null;
  return Dsa.findOne({
    dsaCode: String(dsaCode).toUpperCase(),
  }).lean();
}

function subdomainFromHost(host) {
  const fromLocal = developmentSubdomain(host);
  if (fromLocal) return fromLocal;
  const hostNoPort = host.includes(':') ? host.split(':')[0] : host;
  if (hostNoPort === 'localhost' || hostNoPort === '127.0.0.1' || hostNoPort === '::1') {
    return '';
  }
  const base = config.publicTenantBaseDomain;
  if (base && hostNoPort.endsWith(`.${base}`)) {
    const sub = hostNoPort.slice(0, -(base.length + 1));
    if (sub && !sub.includes('.')) return sub;
  }
  if (!hostNoPort.includes('.')) return hostNoPort;
  return '';
}

async function findDsaForHost(host) {
  assertDatabaseReady();
  for (const candidate of domainLookupCandidates(host)) {
    const byDomain = await Dsa.findOne({
      $or: [{ domain: candidate }, { customDomains: candidate }],
    }).lean();
    if (byDomain) {
      return {
        dsa: byDomain,
        source: byDomain.domain === candidate ? 'domain' : 'custom_domain',
      };
    }
  }
  const sub = subdomainFromHost(host);
  if (sub) {
    const bySub = await Dsa.findOne({ subdomain: sub }).lean();
    if (bySub) return { dsa: bySub, source: 'subdomain' };
  }
  return null;
}

function assertWebsiteOpen(dsa) {
  if (!dsa || String(dsa.status).toUpperCase() !== 'ACTIVE') {
    throw AppError.forbidden('This website is temporarily unavailable');
  }
  if (dsa.websiteAccess && dsa.websiteAccess.status === 'REVOKED') {
    throw AppError.forbidden('This website is temporarily unavailable');
  }
}

async function resolvePublicTenant(req) {
  const host = extractRequestHost(req);
  if (!host) {
    throw AppError.notFound('Website host could not be resolved');
  }

  // 1) Development-only host → DSA code map (never trusted in production).
  if (!config.isProduction && config.publicDevHostMap?.size) {
    const mappedCode = config.publicDevHostMap.get(host);
    if (mappedCode) {
      const dsa = await findDsaByCode(mappedCode);
      if (!dsa) {
        throw AppError.notFound('Development tenant mapping points to an unavailable DSA');
      }
      assertWebsiteOpen(dsa);
      return { dsa, host, source: 'dev_host_map' };
    }
  }

  const matched = await findDsaForHost(host);
  if (!matched) {
    throw AppError.notFound('No active website found for this domain');
  }
  assertWebsiteOpen(matched.dsa);
  return { dsa: matched.dsa, host, source: matched.source };
}

module.exports = {
  resolvePublicTenant,
  extractRequestHost,
  findDsaByCode,
  findActiveDsaByCode: async (code) => {
    const dsa = await findDsaByCode(code);
    if (!dsa || String(dsa.status).toUpperCase() !== 'ACTIVE') return null;
    return dsa;
  },
  parseDevHostMap,
};
