'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');
const DsaCustomerMembership = require('../models/DsaCustomerMembership');
const Dsa = require('../../tenant/models/Dsa');

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function referralPrefix(dsaCode) {
  const digits = String(dsaCode || '').replace(/\D/g, '');
  return digits.slice(-4) || 'DSA';
}

async function allocateReferralCode(dsaId) {
  const dsa = await Dsa.findById(dsaId).select('dsaCode').lean();
  const prefix = referralPrefix(dsa?.dsaCode);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    let body = '';
    for (const byte of bytes) body += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
    const code = `${prefix}-${body}`;
    const taken = await DsaCustomerMembership.findOne({ referralCode: code }).select('_id').lean();
    if (!taken) return code;
  }
  throw AppError.validation('Could not allocate a referral code');
}

async function ensureReferralCode(membership) {
  if (!membership || membership.referralCode) return membership;
  membership.referralCode = await allocateReferralCode(membership.dsaId);
  await membership.save();
  return membership;
}

async function allocateCustomerCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `CUS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const taken = await DsaCustomerMembership.findOne({ customerCode: code }).select('_id').lean();
    if (!taken) return code;
  }
  throw AppError.validation('Could not allocate a customer code');
}

/**
 * Create the DSA relationship on first use.
 * A removed or suspended membership is never silently reactivated.
 */
async function ensureMembership({ userId, dsaId }) {
  if (!userId || !dsaId) return null;
  const existing = await DsaCustomerMembership.findOne({ userId, dsaId });
  if (existing) {
    if (existing.status === 'ACTIVE') {
      existing.lastActiveAt = new Date();
      await existing.save();
    }
    return ensureReferralCode(existing);
  }
  const created = await DsaCustomerMembership.create({
    userId,
    dsaId,
    customerCode: await allocateCustomerCode(),
    status: 'ACTIVE',
    joinedAt: new Date(),
    lastActiveAt: new Date(),
  });
  return ensureReferralCode(created);
}

/**
 * Login and protected B2C calls must already have a membership.
 * They do not create one. Signup and DSAAdmin provisioning do that.
 */
async function assertCustomerCanUseDsa({ userId, dsaId }) {
  const membership = await DsaCustomerMembership.findOne({ userId, dsaId });
  if (!membership) {
    throw AppError.forbidden('Your account is not registered on this website');
  }
  if (membership.status !== 'ACTIVE') {
    throw AppError.forbidden('Your account is not active on this website');
  }
  membership.lastActiveAt = new Date();
  await membership.save();
  return ensureReferralCode(membership);
}

module.exports = {
  ensureMembership,
  assertCustomerCanUseDsa,
  ensureReferralCode,
  allocateReferralCode,
};
