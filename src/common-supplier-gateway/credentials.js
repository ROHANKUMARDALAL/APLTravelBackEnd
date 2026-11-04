'use strict';

const { decryptJson } = require('./crypto');
const SupplierCredential = require('./models/SupplierCredential');
const { resolveSupplierCredentials } = require('../suppliers/runtime/credential-resolver');

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function assertAllowedHost(secrets, allowedHosts, isMock) {
  const baseUrl = secrets?.baseUrl || '';
  if (!baseUrl || isMock) return;
  const host = hostOf(baseUrl);
  const allow = (allowedHosts || []).map((item) => String(item).toLowerCase());
  if (!host || !allow.includes(host)) {
    throw new Error('SUPPLIER_HOST_NOT_ALLOWED');
  }
}

/**
 * APL uses APL secrets only. CLIENT uses that DSA's ciphertext only.
 * HYBRID keeps the credential owner configured on each assignment.
 * A missing client secret never falls back to APL or another DSA.
 */
function credentialSource(entry) {
  const mode = String(entry.ownershipMode || 'APL').toUpperCase();
  const owner = String(entry.credentialOwner || (mode === 'CLIENT' ? 'CLIENT' : 'APL')).toUpperCase();
  if (mode === 'APL' && owner !== 'APL') return { allowed: false, reason: 'APL_MODE_REJECTS_CLIENT' };
  if (mode === 'CLIENT' && owner !== 'CLIENT') return { allowed: false, reason: 'CLIENT_MODE_REJECTS_APL' };
  if (!['APL', 'CLIENT'].includes(owner)) return { allowed: false, reason: 'CREDENTIAL_OWNER_REQUIRED' };
  return { allowed: true, owner, mode };
}

async function resolveAssignmentCredentials(entry, options = {}) {
  const source = credentialSource(entry);
  if (!source.allowed) {
    return { configured: false, reason: source.reason, secrets: null, meta: { configured: false, ownership: source.mode } };
  }
  const owner = source.owner;
  if (owner === 'CLIENT') {
    if (!entry.dsaId || !entry.credentialConfigId) {
      return { configured: false, reason: 'CLIENT_CREDENTIAL_MISSING', secrets: null, meta: { configured: false } };
    }
    const doc = await SupplierCredential.findOne({
      _id: entry.credentialConfigId,
      dsaId: entry.dsaId,
      supplierId: entry.supplierId,
      environment: entry.environment || 'TEST',
      ownership: 'CLIENT',
      status: 'ACTIVE',
    }).lean();
    if (!doc) {
      return { configured: false, reason: 'CLIENT_CREDENTIAL_NOT_FOUND', secrets: null, meta: { configured: false } };
    }
    const secret = options.encryptionKey || process.env.GATEWAY_CREDENTIAL_KEY;
    const secrets = decryptJson(doc, secret);
    assertAllowedHost(secrets, entry.allowedHosts, entry.isMock);
    return {
      configured: true,
      credentialConfigId: String(doc._id),
      secrets,
      meta: {
        configured: true,
        ownership: 'CLIENT',
        environment: doc.environment,
        credentialConfigId: String(doc._id),
      },
    };
  }

  const resolved = resolveSupplierCredentials({
    credentialRef: entry.credentialRef,
    environment: entry.environment || 'TEST',
    supplierCode: entry.supplierCode,
  });
  assertAllowedHost(resolved.secrets, entry.allowedHosts, entry.isMock !== false);
  return {
    configured: resolved.configured,
    secrets: resolved.secrets,
    meta: { ...resolved.meta, ownership: 'APL' },
  };
}

function publicCredential(doc) {
  return {
    id: String(doc._id),
    dsaId: String(doc.dsaId),
    supplierId: String(doc.supplierId),
    environment: doc.environment,
    ownership: doc.ownership,
    status: doc.status,
    configured: Boolean(doc.configured),
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  credentialSource,
  resolveAssignmentCredentials,
  publicCredential,
  assertAllowedHost,
};
