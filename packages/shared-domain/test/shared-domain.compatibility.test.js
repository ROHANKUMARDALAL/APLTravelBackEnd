'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const shared = require('..');
const {
  isServiceOffered,
  DsaStatus,
  DSA_STATUSES,
  SERVICE_GLOBAL_STATUSES,
  ServiceCode,
  ProductType,
  BookingStatus,
  PaymentStatus,
  CancellationStatus,
  RefundStatus,
  RULE_KINDS,
  SupplierEnvironment,
  RoutingStrategy,
  ROLE_SCOPE,
  CONTRACTS,
  OWNERSHIP,
  security,
  tenant,
  customerIdentity,
  normalizePaymentStatus,
} = shared;

describe('@apl/shared-domain compatibility', () => {
  it('exports package identity', () => {
    assert.equal(shared.PACKAGE_NAME, '@apl/shared-domain');
    assert.equal(shared.PACKAGE_VERSION, '1.0.0');
  });

  it('canonical DSA statuses match persisted Mongo values', () => {
    assert.deepEqual([...DSA_STATUSES], ['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
    assert.equal(DsaStatus.ACTIVE, 'ACTIVE');
  });

  it('canonical service global statuses', () => {
    assert.deepEqual([...SERVICE_GLOBAL_STATUSES], ['ACTIVE', 'INACTIVE']);
  });

  it('canonical service codes and product types', () => {
    assert.equal(ServiceCode.FLIGHT, 'flight');
    assert.equal(ServiceCode.HOTEL, 'hotel');
    assert.equal(ServiceCode.BUS, 'bus');
    assert.equal(ServiceCode.TRANSFER, 'transfer');
    assert.equal(ProductType.FLIGHT, 'FLIGHT');
    assert.equal(ProductType.HOTEL, 'HOTEL');
  });

  it('canonical booking / payment / refund / cancellation statuses', () => {
    assert.equal(BookingStatus.CONFIRMED, 'CONFIRMED');
    assert.equal(PaymentStatus.SUCCESS, 'SUCCESS');
    assert.equal(CancellationStatus.REQUESTED, 'REQUESTED');
    assert.equal(RefundStatus.SUCCESS, 'SUCCESS');
    assert.equal(normalizePaymentStatus('CAPTURED'), PaymentStatus.SUCCESS);
    assert.equal(normalizePaymentStatus('AUTHORIZED'), PaymentStatus.SUCCESS);
  });

  it('canonical pricing rule kinds and supplier enums', () => {
    assert.equal(RULE_KINDS.APL_MARKUP, 'APL_MARKUP');
    assert.equal(RULE_KINDS.DSA_MARKUP_CEILING, 'DSA_MARKUP_CEILING');
    assert.equal(SupplierEnvironment.TEST, 'TEST');
    assert.equal(SupplierEnvironment.LIVE, 'LIVE');
    assert.equal(RoutingStrategy.PARALLEL, 'PARALLEL');
    assert.equal(RoutingStrategy.PRIORITY, 'PRIORITY');
    assert.equal(RoutingStrategy.FALLBACK, 'FALLBACK');
    assert.equal(ROLE_SCOPE.APL, 'APL');
    assert.equal(ROLE_SCOPE.DSA, 'DSA');
  });

  it('service-offer rule — all four gates required', () => {
    const dsa = { status: 'ACTIVE' };
    const service = { globalStatus: 'ACTIVE' };
    const mapping = { isAllowedByAPL: true, isActiveByDSA: true };
    assert.equal(isServiceOffered({ dsa, service, mapping }), true);
    assert.equal(
      isServiceOffered({ dsa: { status: 'SUSPENDED' }, service, mapping }),
      false,
    );
    assert.equal(
      isServiceOffered({
        dsa,
        service: { globalStatus: 'INACTIVE' },
        mapping,
      }),
      false,
    );
    assert.equal(
      isServiceOffered({
        dsa,
        service,
        mapping: { isAllowedByAPL: false, isActiveByDSA: true },
      }),
      false,
    );
    assert.equal(
      isServiceOffered({
        dsa,
        service,
        mapping: { isAllowedByAPL: true, isActiveByDSA: false },
      }),
      false,
    );
    assert.equal(isServiceOffered({ dsa, service, mapping: null }), false);
  });

  it('DsaService field authority is documented', () => {
    assert.equal(OWNERSHIP.DsaService.fieldAuthority.isAllowedByAPL, 'APLADMIN');
    assert.equal(OWNERSHIP.DsaService.fieldAuthority.isActiveByDSA, 'DSAADMIN');
    assert.equal(CONTRACTS.DsaService.fieldAuthority.isAllowedByAPL, 'APLADMIN');
  });

  it('Booking contract requires dsaId tenant scope', () => {
    assert.ok(CONTRACTS.Booking.required.includes('dsaId'));
    assert.equal(CONTRACTS.Booking.tenantScope, 'dsaId');
    assert.ok(CONTRACTS.WebsiteSettings.required.includes('dsaId'));
  });

  it('tenant strip helpers remove client selectors', () => {
    const cleaned = tenant.stripClientTenantSelectors({
      dsaId: 'spoof',
      tenantId: 'spoof2',
      origin: 'DEL',
    });
    assert.equal(cleaned.dsaId, undefined);
    assert.equal(cleaned.tenantId, undefined);
    assert.equal(cleaned.origin, 'DEL');
    assert.equal(tenant.isClientTenantHeader('X-DSA-ID'), true);
    assert.equal(tenant.isClientTenantKey('dsaId'), true);
  });

  it('customer identity direction is GLOBAL USER + DSA MEMBERSHIP', () => {
    assert.equal(
      customerIdentity.CUSTOMER_IDENTITY_DIRECTION,
      'GLOBAL_USER_PLUS_DSA_MEMBERSHIP',
    );
    assert.ok(customerIdentity.FUTURE_MEMBERSHIP_FIELDS.includes('userId'));
    assert.ok(customerIdentity.FUTURE_MEMBERSHIP_FIELDS.includes('dsaId'));
  });
});

describe('@apl/shared-domain serialization security', () => {
  it('omits password hashes and session hashes', () => {
    const out = security.omitSensitiveKeys({
      email: 'a@b.com',
      passwordHash: 'secret',
      tokenHash: 'th',
      sessionHash: 'sh',
      role: 'admin',
    });
    assert.equal(out.email, 'a@b.com');
    assert.equal(out.role, 'admin');
    assert.equal(out.passwordHash, undefined);
    assert.equal(out.tokenHash, undefined);
    assert.equal(out.sessionHash, undefined);
  });

  it('omits supplier secrets', () => {
    const out = security.omitSensitiveKeys({
      code: 'TBO',
      apiKey: 'k',
      clientSecret: 's',
      password: 'p',
      credentials: { user: 'u' },
    });
    assert.equal(out.code, 'TBO');
    assert.equal(out.apiKey, undefined);
    assert.equal(out.clientSecret, undefined);
    assert.equal(out.password, undefined);
    assert.equal(out.credentials, undefined);
  });

  it('strips confidential APL commercial fields for DSAAdmin/public', () => {
    const snap = {
      customerFinal: 1200,
      dsaMarkup: 50,
      aplMarkup: 80,
      supplierCost: 1000,
      internalMargin: 30,
      currency: 'INR',
    };
    const out = security.stripConfidentialCommercial({
      commercialSnapshot: snap,
      total: 1200,
    });
    assert.equal(out.total, 1200);
    assert.equal(out.commercialSnapshot.customerFinal, 1200);
    assert.equal(out.commercialSnapshot.dsaMarkup, 50);
    assert.equal(out.commercialSnapshot.aplMarkup, undefined);
    assert.equal(out.commercialSnapshot.supplierCost, undefined);
    assert.equal(out.commercialSnapshot.internalMargin, undefined);
  });

  it('public CMS projection drops sensitive keys', () => {
    const out = security.publicCmsProjection({
      websiteName: 'Demo',
      logoUrl: '/x.png',
      apiKey: 'nope',
      passwordHash: 'nope',
    });
    assert.equal(out.websiteName, 'Demo');
    assert.equal(out.apiKey, undefined);
    assert.equal(out.passwordHash, undefined);
  });
});
