'use strict';

const { mongoose } = require('../../common/database/connection');

const GatewayOfferSchema = new mongoose.Schema(
  {
    offerRef: { type: String, required: true, unique: true },
    dsaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    supplierId: { type: String, default: '' },
    supplierCode: { type: String, required: true },
    credentialConfigId: { type: String, default: '' },
    credentialOwner: { type: String, enum: ['APL', 'CLIENT'], default: 'APL' },
    environment: { type: String, enum: ['TEST', 'LIVE'], default: 'TEST' },
    serviceCode: { type: String, required: true },
    searchId: { type: String, default: '' },
    fareId: { type: String, default: '' },
    supplierOfferRef: { type: String, default: '' },
    currency: { type: String, default: 'INR' },
    customerPayable: { type: Number, required: true },
    comparabilityKey: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    alternatives: { type: [mongoose.Schema.Types.Mixed], default: [] },
    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: true },
);

GatewayOfferSchema.index({ dsaId: 1, searchId: 1, fareId: 1 });
GatewayOfferSchema.index(
  { dsaId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
GatewayOfferSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.GatewayOffer
  || mongoose.model('GatewayOffer', GatewayOfferSchema);
