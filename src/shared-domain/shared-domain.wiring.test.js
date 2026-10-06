'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const shared = require('@apl/shared-domain');
const { isServiceOffered: offerFromService } = require('../tenant/services/service-offer.service');
const { DSA_STATUSES } = require('../tenant/models/Dsa');
const { SERVICE_GLOBAL_STATUSES } = require('../tenant/models/Service');
const { RULE_KINDS } = require('../pricing/services/pricing-engine.service');
const {
  PaymentStatus,
  normalizePaymentStatus,
  RefundStatus,
  CancellationStatus,
} = require('../payments/status');
const { stripClientTenantSelectors } = require('../tenant/services/transaction-tenant.service');

describe('Phase 15D shared-domain wiring', () => {
  it('service-offer.service re-exports canonical isServiceOffered', () => {
    assert.equal(offerFromService, shared.isServiceOffered);
    const ok = offerFromService({
      dsa: { status: 'ACTIVE' },
      service: { globalStatus: 'ACTIVE' },
      mapping: { isAllowedByAPL: true, isActiveByDSA: true },
    });
    assert.equal(ok, true);
  });

  it('Dsa / Service models use shared status enums', () => {
    assert.deepEqual([...DSA_STATUSES], [...shared.DSA_STATUSES]);
    assert.deepEqual(
      [...SERVICE_GLOBAL_STATUSES],
      [...shared.SERVICE_GLOBAL_STATUSES],
    );
  });

  it('pricing engine RULE_KINDS match shared package', () => {
    assert.deepEqual(RULE_KINDS, shared.RULE_KINDS);
  });

  it('payments/status re-exports shared payment vocabularies', () => {
    assert.equal(PaymentStatus.SUCCESS, shared.PaymentStatus.SUCCESS);
    assert.equal(RefundStatus.FAILED, shared.RefundStatus.FAILED);
    assert.equal(CancellationStatus.CONFIRMED, shared.CancellationStatus.CONFIRMED);
    assert.equal(normalizePaymentStatus('CAPTURED'), PaymentStatus.SUCCESS);
  });

  it('transaction tenant strip uses shared CLIENT_TENANT_KEYS', () => {
    const req = {
      body: { dsaId: 'evil', origin: 'BOM' },
      query: { tenant_id: 'evil2', cabin: 'Y' },
      headers: { 'x-dsa-id': 'evil3', host: 'demo.localhost' },
    };
    stripClientTenantSelectors(req);
    assert.equal(req.body.dsaId, undefined);
    assert.equal(req.body.origin, 'BOM');
    assert.equal(req.query.tenant_id, undefined);
    assert.equal(req.query.cabin, 'Y');
    assert.equal(req.headers['x-dsa-id'], undefined);
    assert.equal(req.headers.host, 'demo.localhost');
  });

  it('Booking product types align with shared ProductType', () => {
    assert.equal(shared.ProductType.FLIGHT, 'FLIGHT');
    assert.equal(shared.ProductType.BUS, 'BUS');
    assert.equal(shared.BookingStatus.PENDING_PAYMENT, 'PENDING_PAYMENT');
  });

  it('OWNERSHIP classifies CMS as shared domain DSA-write / B2C-read', () => {
    assert.equal(shared.OWNERSHIP.WebsiteSettings.classification, 'SHARED_DOMAIN');
    assert.match(shared.OWNERSHIP.WebsiteSettings.DSAADMIN, /CRUD/);
    assert.match(shared.OWNERSHIP.WebsiteSettings.B2C, /R/);
  });

  it('OWNERSHIP classifies Booking as shared with tenant scope', () => {
    assert.equal(shared.OWNERSHIP.Booking.classification, 'SHARED_DOMAIN');
    assert.match(shared.OWNERSHIP.Booking.DSAADMIN, /own dsaId/);
  });
});
