'use strict';

/**
 * Canonical required-field contracts for collections that MUST share one schema
 * across B2C / DSAAdmin / APLAdmin backends (same MongoDB).
 * Mongoose models remain the runtime source until extraction; these contracts
 * are the versioned agreement for future repos consuming @apl/shared-domain.
 */

const CONTRACTS = Object.freeze({
  Dsa: {
    required: [
      'dsaCode',
      'companyName',
      'displayName',
      'ownerName',
      'email',
      'phone',
      'status',
    ],
    indexes: [
      ['dsaCode', { unique: true }],
      ['domain', { unique: true, partial: true }],
      ['subdomain', { unique: true, partial: true }],
    ],
  },
  Service: {
    required: ['code', 'name', 'slug', 'globalStatus'],
    indexes: [['code', { unique: true }], ['slug', { unique: true }]],
  },
  DsaService: {
    required: ['dsaId', 'serviceId', 'isAllowedByAPL', 'isActiveByDSA'],
    indexes: [['dsaId', 'serviceId', { unique: true }]],
    fieldAuthority: {
      isAllowedByAPL: 'APLADMIN',
      isActiveByDSA: 'DSAADMIN',
    },
  },
  Supplier: {
    required: ['code', 'name', 'status'],
  },
  SupplierService: {
    required: ['supplierId', 'serviceCode'],
  },
  DsaSupplier: {
    required: ['dsaId', 'supplierId', 'environment'],
  },
  PricingRule: {
    required: ['kind', 'ownerScope', 'status', 'adjustmentType'],
  },
  Booking: {
    required: ['dsaId', 'productType', 'status', 'requestId'],
    tenantScope: 'dsaId',
    notes: 'commercialSnapshot required on priced bookings; payment link optional until paid',
  },
  Payment: {
    required: ['status', 'amount', 'currency'],
    tenantScope: 'dsaId',
  },
  CancellationRequest: {
    required: ['bookingId', 'status', 'dsaId'],
  },
  Refund: {
    required: ['paymentId', 'status', 'amount', 'dsaId'],
  },
  WebsiteSettings: {
    required: ['dsaId'],
    tenantScope: 'dsaId',
  },
  ServiceLog: {
    required: ['requestId', 'service'],
    tenantScope: 'dsaId',
  },
});

module.exports = { CONTRACTS };
