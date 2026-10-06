# Shared Domain Contract (Phase 15D)

**Status:** Active  
**Package:** `@apl/shared-domain` → `packages/shared-domain`  
**Version:** `1.0.0` (private, not published)  
**Database:** One MongoDB database per environment (unchanged)

---

## Why this exists

Future backends (B2C / DSAAdmin / APLAdmin) may become **separate codebases** that still share **one MongoDB**. Without a shared contract, Booking/Pricing/CMS schemas would diverge.

Phase 15D establishes the contract **before** physical extraction (15E/15F).

---

## Package strategy (chosen)

**OPTION A — Internal workspace package (current)**

- Path: `packages/shared-domain`
- Dependency: `"@apl/shared-domain": "file:packages/shared-domain"`
- Contains: enums/constants, ownership matrix, required-field contracts, pure service-offer rule, tenant spoof-strip helpers, serialization guards, **canonical Mongoose models** (`models/Dsa`, `Service`, `DsaService` — more migrate here over 15E–15G)
- Does **not** contain Express controllers/routes/UI

**Multi-repo consumption (15E+)**

- Canonical package home during transition: `APLTravelBackEnd/packages/shared-domain`
- `DSAAdminBackEnd` vendors a copy under `packages/shared-domain` (`npm run sync:shared-domain`)
- Later: private npm `@apl/shared-domain@1.x` (do not publish publicly)

Consumers pin a semver range (`^1.0.0`). Schema changes are additive first; major bumps only for breaking persisted value changes.

**Do not** publish publicly in this phase.

---

## Domain inventory (code-verified)

| Domain | Models (runtime locations today) |
|--------|----------------------------------|
| TENANT / PLATFORM | `Dsa`, `Service`, `DsaService`, `Counter` (`src/tenant/models`) |
| SUPPLIER | `Supplier`, `SupplierService`, `DsaSupplier`, `SupplierMapping`, `SupplierRawPayload` (`src/common/database/models` + supplier models) |
| TRANSACTIONS | `Search`, `CheckoutSession`, `Booking`, `Payment`, `CancellationRequest`, `Refund` |
| PRICING | `PricingRule` + commercialSnapshot structures on offers/bookings |
| CMS | `WebsiteSettings`, `Blog`, `Testimonial`, `FooterLink`, `CmsPage`, `Banner` (`src/cms/models`) |
| AUTH | `User`, `AplAdminUser`, `AplAdminSession`, `DsaAdminUser`, `DsaAdminSession`, `AdminRole` |
| OBSERVABILITY | `ServiceLog` (+ admin action logs) |

Canonical ownership matrix: `packages/shared-domain/contracts/ownership.js` (`OWNERSHIP`).

---

## Ownership principle

Shared database ≠ equal authority.

Example — `DsaService`:

| Field | Writer |
|-------|--------|
| `isAllowedByAPL` | APLAdmin only |
| `isActiveByDSA` | DSAAdmin only |
| Effective offer | All apps **read/evaluate** via `isServiceOffered` |

---

## Models that MUST share one schema contract

Documented in `packages/shared-domain/contracts/required-fields.js`:

`Dsa`, `Service`, `DsaService`, `Supplier`, `SupplierService`, `DsaSupplier`, `PricingRule`, `Booking`, `Payment`, `CancellationRequest`, `Refund`, `WebsiteSettings`, `ServiceLog`

Mongoose model **classes** for `Dsa` / `Service` / `DsaService` now live in `@apl/shared-domain/models`. Other shared collections still reside in app `src/**/models` and must migrate before 15G (no forked copies).

---

## Canonical enums / constants

| Area | Symbols |
|------|---------|
| Services | `ServiceCode`, `ProductType`, `SERVICE_GLOBAL_STATUSES` |
| DSA | `DsaStatus`, `DSA_STATUSES` |
| Booking | `BookingStatus`, `HoldStatus` |
| Payments | `PaymentStatus`, `CancellationStatus`, `RefundStatus`, `BookingConfirmStatus`, `normalizePaymentStatus` |
| Pricing | `RULE_KINDS`, `PricingOwnerScope`, `AdjustmentType` |
| Suppliers | `SupplierEnvironment` (TEST/LIVE), `RoutingStrategy` (PARALLEL/PRIORITY/FALLBACK) |
| Auth | `AdminAccountStatus`, `ROLE_SCOPE` |
| Tenant spoof keys | `CLIENT_TENANT_KEYS`, `CLIENT_TENANT_HEADERS` |

Permission codes remain in `src/admin-auth/permissions.js` (catalogue grows with admin features); scopes use `ROLE_SCOPE`.

**Backward compatibility:** persisted Mongo string values are unchanged.

---

## Tenant contract

| Surface | Trusted identity |
|---------|------------------|
| PUBLIC B2C | Host → DSA resolver → `req.tenant.dsaId` |
| DSAADMIN | Session → `DsaAdminUser.dsaId` → `req.tenant.dsaId` |
| APLADMIN | Platform session; target DSA only on authorized platform routes |

**Never trust** `body.dsaId`, `query.dsaId`, `X-DSA-ID` for authority.  
Implemented: `stripClientTenantSelectors` in `transaction-tenant.service.js` using shared `CLIENT_TENANT_KEYS`.

---

## Service offer rule (CENTRALIZED)

```
offered =
  Service.globalStatus === ACTIVE
  AND Dsa.status === ACTIVE
  AND DsaService.isAllowedByAPL === true
  AND DsaService.isActiveByDSA === true
```

Canonical pure function: `@apl/shared-domain` → `isServiceOffered`.  
DB wrappers: `src/tenant/services/service-offer.service.js`.

---

## Pricing contract

Pipeline (unchanged):

Supplier Base → commission/commercial → APL markup → DSA markup → service fee → discount → customer final.

- `commercialSnapshot` must remain readable by all backends that need ops views.
- **Shared schema ≠ shared API exposure:** DSAAdmin/B2C must not receive confidential APL margin fields. Use `security.stripConfidentialCommercial`.

---

## Booking contract

Required concepts: `dsaId`, customer ownership, `productType` / service, supplier reference, `requestId`, `commercialSnapshot`, payment relationship, `status`, cancel/refund links, snapshots.

| Backend | Access |
|---------|--------|
| APLAdmin | Platform-wide inspect / ops |
| DSAAdmin | `Booking.dsaId = authenticated tenant` only |
| B2C | Create/update under customer + tenant ownership |

---

## CMS contract

DSA-owned operational data; B2C publishes reads via same Mongo collections.

- DSAAdmin Backend → writes  
- B2C Backend → reads/publishes  
- APLAdmin does **not** automatically gain CMS mutation

---

## Customer identity (design only)

**Direction:** GLOBAL USER + DSA MEMBERSHIP  

- `User` = global identity  
- Future `DsaCustomerMembership`: `userId`, `dsaId`, `status`, `createdAt`, `lastUsedAt`  
- Do **not** put sole tenancy as `User.dsaId`  
- Not implemented in 15D

---

## Schema migration strategy

Preferred: **backward-compatible additive migrations first**.

1. Deploy DB-compatible schema (new optional fields / indexes)  
2. Deploy readers supporting old + new  
3. Deploy writers using new fields  
4. Backfill only if necessary  
5. Later enforce stricter required  

**Forbidden in 15D:** destructive migrations, enum value renames without dual-read window.

### Index ownership

**One designated runner:** this monolith’s Mongoose `ensureIndexes` / seed scripts (`scripts/seed-*.js`) until extraction.

After split: a single **shared-domain migration/index script** (or one designated backend) owns index creation. Other backends must not invent conflicting indexes.

---

## Serialization security

Helpers in `packages/shared-domain/security/serialize.js`:

- `omitSensitiveKeys` — passwords, session/token hashes, supplier secrets  
- `stripConfidentialCommercial` — APL-internal margin/cost  
- `publicCmsProjection` — last-line public CMS filter  

Tests: `packages/shared-domain/test/shared-domain.compatibility.test.js`.

---

## Compatibility tests

- `npm run test:shared-domain`  
- Phase 15C: `src/tenant/services/multi-dsa-validation.integration.test.js`  
- Existing tenant / pricing / payment / supplier / CMS / readiness / admin suites

---

## Related docs

- `docs/BACKEND_EXTRACTION_MAP.md` — Phase 15E/15F move map  
- `docs/ADMIN_BACKEND_ARCHITECTURE.md` — physical split design  
- `docs/MULTI_DSA_VALIDATION.md` — Phase 15C isolation proof  
- `docs/DATABASE_ARCHITECTURE.md` — one DB per env  
