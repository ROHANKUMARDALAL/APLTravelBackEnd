'use strict';

const { AppError } = require('../../common/errors/app-error');
const { config } = require('../../common/config');
const Dsa = require('../../tenant/models/Dsa');
const {
  normalizeHost,
  parseDevHostMap,
  isLocalHost,
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

async function findActiveDsaByDomain(domain) {
  if (!domain) return null;
  return Dsa.findOne({
    domain,
    status: 'ACTIVE',
  }).lean();
}

async function findActiveDsaBySubdomain(subdomain) {
  if (!subdomain) return null;
  return Dsa.findOne({
    subdomain,
    status: 'ACTIVE',
  }).lean();
}

async function findActiveDsaByCode(dsaCode) {
  if (!dsaCode) return null;
  return Dsa.findOne({
    dsaCode: String(dsaCode).toUpperCase(),
    status: 'ACTIVE',
  }).lean();
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
      const dsa = await findActiveDsaByCode(mappedCode);
      if (!dsa) {
        throw AppError.notFound('Development tenant mapping points to an unavailable DSA');
      }
      return {
        dsa,
        host,
        source: 'dev_host_map',
      };
    }
  }

  // 2) Exact custom domain match (local: try with/without port).
  for (const candidate of domainLookupCandidates(host)) {
    const byDomain = await findActiveDsaByDomain(candidate);
    if (byDomain) {
      return { dsa: byDomain, host, source: 'domain' };
    }
  }

  // 3) Subdomain of configured public base domain: {sub}.{base}
  const hostNoPort = host.includes(':') ? host.split(':')[0] : host;
  const base = config.publicTenantBaseDomain;
  if (base && hostNoPort.endsWith(`.${base}`)) {
    const sub = hostNoPort.slice(0, -(base.length + 1));
    if (sub && !sub.includes('.')) {
      const bySub = await findActiveDsaBySubdomain(sub);
      if (bySub) {
        return { dsa: bySub, host, source: 'subdomain' };
      }
    }
  }

  // 4) Also try host as subdomain token alone (legacy/simple setups).
  if (!hostNoPort.includes('.')) {
    const bySubAlone = await findActiveDsaBySubdomain(hostNoPort);
    if (bySubAlone) {
      return { dsa: bySubAlone, host, source: 'subdomain' };
    }
  }

  // Distinguish suspended DSA that owns the domain (do not leak other tenants).
  for (const candidate of domainLookupCandidates(host)) {
    const anyDomain = await Dsa.findOne({ domain: candidate }).lean();
    if (anyDomain && String(anyDomain.status).toUpperCase() !== 'ACTIVE') {
      throw AppError.forbidden('This website is temporarily unavailable');
    }
  }

  throw AppError.notFound('No active website found for this domain');
}

module.exports = {
  resolvePublicTenant,
  extractRequestHost,
  findActiveDsaByCode,
  parseDevHostMap,
};
