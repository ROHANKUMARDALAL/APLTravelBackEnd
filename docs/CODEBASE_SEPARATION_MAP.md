# Codebase Separation Map (Phase 15E)

**Source of truth:** current paths in `APLTravelBackEnd`  
**Legend:** `B2C_BACKEND` · `DSAADMIN_BACKEND` · `APLADMIN_BACKEND` · `SHARED_DOMAIN` · `SHARED_INFRASTRUCTURE` · `TEMPORARY`

---

## Frontends

| Current | Target codebase | Notes |
|---------|-----------------|-------|
| `travelweb/b2c-travel/**` | `APLTravelFrontend` | EXISTS as APL-Travel remote |
| `DSAAdmin/**` | `DSAAdminFrontCode` | EXISTS (folder name DSAAdmin) |
| `APLAdmin/**` | `APLAdminFrontCode` | EXISTS |

---

## Backend entry / mounts

| Current path | Classification | Target |
|--------------|----------------|--------|
| `src/server.js` | TEMPORARY (split) | Each backend owns its `server.js` |
| `src/app.js` | TEMPORARY | B2C keeps travel+public; admin mounts deprecated after 15E/15F |
| `src/dsa-admin/**` | DSAADMIN_BACKEND | `DSAAdminBackEnd/src/dsa-admin/**` |
| `src/apl-admin/**` | APLADMIN_BACKEND | `APLAdminBackEnd` (15F) |
| `src/public-site/**` | B2C_BACKEND | stays |
| `src/flight|hotel|bus|transfer|booking|user/**` | B2C_BACKEND | stays |
| `src/health/**` | SHARED_INFRASTRUCTURE | copy/thin per process |

---

## Shared domain

| Current path | Classification | Target |
|--------------|----------------|--------|
| `packages/shared-domain/**` | SHARED_DOMAIN | consumed by all three backends |
| `packages/shared-domain/models/**` | SHARED_DOMAIN | canonical Mongoose schemas (15E+) |
| Enums / `isServiceOffered` / tenant strip / serialize | SHARED_DOMAIN | already present |

---

## DSAAdmin extraction set (15E)

| Current path | Classification | Target path |
|--------------|----------------|-------------|
| `src/dsa-admin/**` | DSAADMIN_BACKEND | `DSAAdminBackEnd/src/dsa-admin/**` |
| `src/cms/**` | DSAADMIN_BACKEND (writes) + B2C reads | DSAAdmin owns write services; B2C keeps read path until shared |
| `src/admin-auth/**` | SHARED_INFRASTRUCTURE | both admin backends; catalogue shared |
| `src/tenant/models/{Dsa,Service,DsaService,Counter}.js` | SHARED_DOMAIN models | `@apl/shared-domain/models` |
| `src/tenant/middleware/tenant-context.js` | SHARED_INFRASTRUCTURE | DSA + B2C patterns |
| `src/tenant/services/dsa-service-mapping.service.js` | SHARED_INFRASTRUCTURE | field authority enforced in callers |
| `src/tenant/services/dsa.service.js` | TEMPORARY | DSAAdmin uses limited profile update; APL owns create/status |
| `src/tenant/services/service-offer.service.js` | SHARED_INFRASTRUCTURE | wraps shared `isServiceOffered` |
| `src/pricing/**` | SHARED_INFRASTRUCTURE | DSA markup paths in DSAAdmin; APL ceilings in 15F |
| `src/payments/services/ops-booking.service.js` | SHARED_INFRASTRUCTURE | audience filter DSA vs APL |
| `src/payments/models/**` + Booking model | SHARED_DOMAIN | read for tenant bookings |
| `src/common/**` | SHARED_INFRASTRUCTURE | duplicate thin infra per backend or future `@apl/shared-infra` |
| `src/apl-admin/services/admin-action-log.js` | SHARED_INFRASTRUCTURE | small audit helper → shared/common |

---

## Must NOT move into DSAAdminBackEnd

| Path | Reason |
|------|--------|
| `src/apl-admin/controllers/**` | Platform APIs → 15F |
| `src/apl-admin/models/AplAdmin*` | APL-only |
| `src/suppliers/runtime` credential resolver secrets | B2C/APL only |
| `src/flight|hotel|bus|transfer` supplier execution | B2C only |

---

## Authority matrix (runtime)

| Collection / field | B2C | DSAAdmin | APLAdmin |
|--------------------|-----|----------|----------|
| `DsaService.isAllowedByAPL` | R | R | RU |
| `DsaService.isActiveByDSA` | R | RU | R |
| `Dsa.status` | R | R | RU |
| `Booking` (tenant) | CRUD own | R own dsaId | R all |
| CMS collections | R public | CRUD own | — |
| Supplier secrets | runtime only | never | manage refs |

---

## Strangler status

| Item | 15E |
|------|-----|
| `DSAAdminBackEnd` process :3004 | Active |
| Legacy `/api/dsa-admin` on :3000 | ACTIVE (compat; remove in 15G) |
| DSAAdmin FE `NEXT_PUBLIC_API_ORIGIN` | → `:3004` |
| `APLAdminBackEnd` | Not started (15F) |
