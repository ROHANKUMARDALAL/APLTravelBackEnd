'use strict';

const crypto = require('crypto');
const { AppError } = require('../common/errors/app-error');
const GatewayOffer = require('./models/GatewayOffer');

function offerRef() {
  return `APL-OFF-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

async function storeDisplayedOffers({ dsaId, searchId, serviceCode, offers, ttlMs = 30 * 60 * 1000 }) {
  if (!dsaId || !Array.isArray(offers) || !offers.length) return [];
  const expiresAt = new Date(Date.now() + ttlMs);
  const stored = [];
  for (const offer of offers) {
    const ref = offerRef();
    await GatewayOffer.create({
      offerRef: ref,
      dsaId,
      supplierId: offer.supplierId || '',
      supplierCode: offer.supplierCode,
      credentialConfigId: offer.credentialConfigId || '',
      credentialOwner: offer.credentialOwner || 'APL',
      environment: offer.environment || 'TEST',
      serviceCode,
      searchId: searchId || '',
      fareId: offer.fareId || '',
      supplierOfferRef: offer.supplierOfferRef || '',
      currency: offer.currency || 'INR',
      customerPayable: offer.customerPayable,
      comparabilityKey: offer.comparabilityKey || '',
      expiresAt,
      alternatives: offer.alternatives || [],
    });
    stored.push({ ...offer, offerRef: ref });
  }
  return stored;
}

async function assertOfferOwnership({ dsaId, searchId, fareId, supplierCode }) {
  if (!dsaId || !fareId) return null;
  const offer = await GatewayOffer.findOne({ dsaId, searchId, fareId }).lean();
  if (!offer) return null;
  if (String(offer.supplierCode).toUpperCase() !== String(supplierCode || '').toUpperCase()) {
    throw AppError.validation('Selected offer is bound to a different supplier');
  }
  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    throw AppError.validation('Selected offer has expired. Search again before booking.');
  }
  return {
    offerRef: offer.offerRef,
    supplierCode: offer.supplierCode,
    credentialConfigId: offer.credentialConfigId,
    credentialOwner: offer.credentialOwner,
    environment: offer.environment,
    customerPayable: offer.customerPayable,
    currency: offer.currency,
  };
}

async function claimOffer({ dsaId, offerRef, idempotencyKey }) {
  const key = String(idempotencyKey || '').trim();
  if (key) {
    const prior = await GatewayOffer.findOne({ dsaId, idempotencyKey: key }).lean();
    if (prior) return { replay: true, offerRef: prior.offerRef, supplierCode: prior.supplierCode };
  }
  const doc = await GatewayOffer.findOneAndUpdate(
    {
      offerRef,
      dsaId,
      $or: [{ idempotencyKey: { $exists: false } }, { idempotencyKey: null }],
    },
    { $set: key ? { idempotencyKey: key } : {} },
    { new: true },
  ).lean();
  if (!doc) {
    const current = await GatewayOffer.findOne({ offerRef, dsaId }).lean();
    if (current && key && current.idempotencyKey === key) {
      return { replay: true, offerRef: current.offerRef, supplierCode: current.supplierCode };
    }
    throw AppError.validation('This offer is already reserved');
  }
  return { replay: false, offerRef: doc.offerRef, supplierCode: doc.supplierCode };
}

function confirmFare({ lockedAmount, quotedAmount, accepted = false }) {
  if (!Number.isFinite(lockedAmount) || !Number.isFinite(quotedAmount)) {
    return { status: 'INVALID' };
  }
  if (quotedAmount !== lockedAmount && accepted !== true) {
    return { status: 'PRICE_CHANGED', previousAmount: lockedAmount, nextAmount: quotedAmount };
  }
  return { status: 'CONFIRMED', amount: quotedAmount };
}

module.exports = { storeDisplayedOffers, assertOfferOwnership, claimOffer, confirmFare };
