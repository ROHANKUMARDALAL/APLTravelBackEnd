'use strict';

/**
 * Ownership matrix (Phase 15D).
 * SHARED DOMAIN = same Mongo collection + one canonical schema contract.
 * Authority is field-level / app-level — not equal CRUD for every backend.
 *
 * CRUD letters: C create, R read, U update, D delete, L limited.
 */

const OWNERSHIP = Object.freeze({
  Dsa: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: 'R+L(U profile/branding)',
    B2C: 'R(tenant resolve)',
  },
  Service: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: 'R',
    B2C: 'R',
  },
  DsaService: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'C/R/U(isAllowedByAPL)',
    DSAADMIN: 'R/U(isActiveByDSA)',
    B2C: 'R(evaluate offer)',
    fieldAuthority: {
      isAllowedByAPL: 'APLADMIN',
      isActiveByDSA: 'DSAADMIN',
    },
  },
  Counter: {
    classification: 'INFRASTRUCTURE',
    APLADMIN: 'R',
    DSAADMIN: '—',
    B2C: 'internal',
  },
  Supplier: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: 'R(assigned only, no secrets)',
    B2C: 'runtime use (no secret exposure)',
  },
  SupplierService: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: 'R',
    B2C: 'R(runtime)',
  },
  DsaSupplier: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: 'R',
    B2C: 'R(runtime routing)',
  },
  SupplierMapping: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: '—',
    B2C: 'R(runtime)',
  },
  SupplierRawPayload: {
    classification: 'B2C_OWNED',
    APLADMIN: 'R(ops)',
    DSAADMIN: '—',
    B2C: 'CRUD(internal)',
  },
  Search: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R',
    DSAADMIN: 'R(own dsaId)',
    B2C: 'CRUD',
  },
  CheckoutSession: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R',
    DSAADMIN: 'R(own dsaId)',
    B2C: 'CRUD',
  },
  Booking: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R/U(ops cancel)',
    DSAADMIN: 'R(own dsaId)',
    B2C: 'CRUD(customer+tenant)',
  },
  Payment: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R(oversight)',
    DSAADMIN: 'R(own dsaId)',
    B2C: 'CRUD(customer flow)',
  },
  CancellationRequest: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R/U(ops)',
    DSAADMIN: 'R(own dsaId)',
    B2C: 'CR(customer)',
  },
  Refund: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R/U(ops)',
    DSAADMIN: 'R(own dsaId)',
    B2C: 'CR(customer flow)',
  },
  PricingRule: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD(PLATFORM + ceilings)',
    DSAADMIN: 'CRUD(DSA kinds only)',
    B2C: 'R(engine apply)',
  },
  WebsiteSettings: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: '—/policy',
    DSAADMIN: 'CRUD',
    B2C: 'R(public)',
  },
  Blog: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: '—',
    DSAADMIN: 'CRUD',
    B2C: 'R(public)',
  },
  Testimonial: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: '—',
    DSAADMIN: 'CRUD',
    B2C: 'R(public)',
  },
  FooterLink: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: '—',
    DSAADMIN: 'CRUD',
    B2C: 'R(public)',
  },
  CmsPage: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: '—',
    DSAADMIN: 'CRUD',
    B2C: 'R(public)',
  },
  Banner: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: '—',
    DSAADMIN: 'CRUD',
    B2C: 'R(public)',
  },
  User: {
    classification: 'SHARED_DOMAIN',
    note: 'Future: GLOBAL USER + DsaCustomerMembership (design only in 15D)',
    APLADMIN: 'R(ops)',
    DSAADMIN: 'R(own memberships)',
    B2C: 'CRUD(auth)',
  },
  AplAdminUser: {
    classification: 'APLADMIN_OWNED',
    APLADMIN: 'CRUD',
    DSAADMIN: '—',
    B2C: '—',
  },
  AplAdminSession: {
    classification: 'APLADMIN_OWNED',
    APLADMIN: 'CRUD',
    DSAADMIN: '—',
    B2C: '—',
  },
  DsaAdminUser: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'C/R/U(provision)',
    DSAADMIN: 'R/U(own team L)',
    B2C: '—',
  },
  DsaAdminSession: {
    classification: 'DSAADMIN_OWNED',
    APLADMIN: '—',
    DSAADMIN: 'CRUD',
    B2C: '—',
  },
  AdminRole: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'CRUD',
    DSAADMIN: 'R',
    B2C: '—',
  },
  ServiceLog: {
    classification: 'SHARED_DOMAIN',
    APLADMIN: 'R',
    DSAADMIN: 'R(own dsaId L)',
    B2C: 'C(internal)',
  },
});

module.exports = { OWNERSHIP };
