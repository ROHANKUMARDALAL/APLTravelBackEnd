# Backend Extraction Map (Phase 15D → 15E/15F)

**Status:** Phase 15E DSAAdmin extraction DONE · APLAdmin extraction = 15F  
**Prerequisite:** Phase 15D shared domain contract (`docs/SHARED_DOMAIN_CONTRACT.md`)  
**See also:** `docs/SIX_CODEBASE_ARCHITECTURE.md`, `docs/CODEBASE_SEPARATION_MAP.md`

Target architecture: separate backend **codebases**, **same MongoDB** per environment.

```
B2C Frontend      → B2C Backend ──────┐
DSAAdmin Frontend → DSAAdmin Backend ─┼──→ SAME MongoDB
APLAdmin Frontend → APLAdmin Backend ─┘
```

---

## Classification legend

| Tag | Meaning |
|-----|---------|
| **STAYS_B2C** | Remains in APLTravelBackEnd (customer/travel API) |
| **MOVES_DSAADMIN** | Extract to future DSAAdminBackEnd |
| **MOVES_APLADMIN** | Extract to future APLAdminBackEnd |
| **MOVES_SHARED** | Consumed as `@apl/shared-domain` (already started) |
| **COMMON_INFRA** | Needs decision: thin copy vs tiny shared infra package |
| **SPLIT_READ_WRITE** | Same models; write path one admin, read path another |

---

## Package / shared

| Path | Classification | Notes |
|------|----------------|-------|
| `packages/shared-domain/**` | **MOVES_SHARED** | Already created; version for all three backends |
| `src/shared-domain/**` | **MOVES_SHARED** | Wiring/compatibility tests only |

---

## App entry & mounts

| Path | Classification | Notes |
|------|----------------|-------|
| `src/server.js` | **COMMON_INFRA** | Each future backend gets its own process entry |
| `src/app.js` | **SPLIT** | Today mounts all three; 15E/F split mounts |
| `src/health/**` | **COMMON_INFRA** | Each process keeps `/health` + `/ready` |
| `src/common/config/**` | **COMMON_INFRA** | Env names may diverge per process |
| `src/common/database/**` | **COMMON_INFRA** + models → shared contract | Connection helper may duplicate; schemas must match shared contracts |
| `src/common/errors/**` | **COMMON_INFRA** | |
| `src/common/middleware/**` | **COMMON_INFRA** / B2C-heavy | `service-log` mostly B2C |
| `src/common/response/**` | **COMMON_INFRA** | |
| `src/common/security/**` | **COMMON_INFRA** | opaque-token, password |
| `src/common/utils/**` | **COMMON_INFRA** | |
| `src/common/media/**` | **SPLIT_READ_WRITE** | DSAAdmin writes CMS media; B2C serves/reads |

---

## B2C Backend (target ownership)

Public tenant config, customer auth, Flight/Hotel/Bus/Transfer, search, supplier execution, revalidation, checkout, booking, payment customer flow, cancel/refund customer flow, My Trips, public CMS reads, transaction logging.

| Path | Classification |
|------|----------------|
| `src/flight/**` | **STAYS_B2C** |
| `src/hotel/**` | **STAYS_B2C** |
| `src/bus/**` | **STAYS_B2C** |
| `src/transfer/**` | **STAYS_B2C** |
| `src/booking/**` | **STAYS_B2C** (customer routes) |
| `src/user/**` | **STAYS_B2C** |
| `src/public-site/**` | **STAYS_B2C** (public CMS/config reads) |
| `src/cms/services/*` (read paths used by public-site) | **SPLIT_READ_WRITE** — **STAYS_B2C** for reads |
| `src/cms/models/**` | **MOVES_SHARED** contract; models may live in B2C + DSAAdmin with same schema |
| `src/common/services/checkout-booking.service.js` | **STAYS_B2C** |
| `src/payments/services/payment.service.js` | **STAYS_B2C** (customer) |
| `src/payments/services/cancellation.service.js` | **STAYS_B2C** (+ ops pieces to APL) |
| `src/payments/providers/**` | **STAYS_B2C** (gateway execution) |
| `src/suppliers/runtime/**` | **STAYS_B2C** |
| `src/suppliers/services/supplier-routing.service.js` | **STAYS_B2C** |
| `src/suppliers/routes/**` | **STAYS_B2C** (if public) / platform catalog stays APL |
| `src/pricing/services/pricing-engine.service.js` | **STAYS_B2C** apply path (+ shared RULE_KINDS) |
| `src/tenant/middleware/require-transaction-tenant.js` | **STAYS_B2C** |
| `src/tenant/services/transaction-tenant.service.js` | **STAYS_B2C** |
| `src/tenant/services/service-offer.service.js` | **STAYS_B2C** + admins (shared rule) |
| `src/common/database/models/Booking.js` etc. | **MOVES_SHARED** contract; runtime models until package owns mongoose |

**Must not move into B2C:** APLAdmin platform DSA creation, supplier secret management UI/APIs, cross-DSA ops.

---

## DSAAdmin Backend (target ownership)

DSAAdmin auth/session, tenant profile, service activation (`isActiveByDSA`), branding/CMS writes, DSA pricing/markup, tenant bookings, ops views, DSA users/team, reports/support.

| Path | Classification |
|------|----------------|
| `src/dsa-admin/**` | **MOVES_DSAADMIN** |
| `src/dsa-admin/models/DsaAdminUser.js` | **MOVES_DSAADMIN** (schema shared with APL provisioner) |
| `src/dsa-admin/models/DsaAdminSession.js` | **MOVES_DSAADMIN** |
| `src/cms/controllers` via `dsa-admin/controllers/cms.controller.js` | **MOVES_DSAADMIN** (writes) |
| `src/cms/models/**` | **SPLIT_READ_WRITE** — write owner DSAAdmin |
| `src/cms/services/**` | **SPLIT_READ_WRITE** — mutate in DSAAdmin; read helpers in B2C |
| `src/dsa-admin/controllers/pricing.controller.js` | **MOVES_DSAADMIN** (DSA rule kinds only) |
| `src/dsa-admin/controllers/bookings.controller.js` | **MOVES_DSAADMIN** (scoped `dsaId`) |
| `src/tenant/middleware/tenant-context.js` | **MOVES_DSAADMIN** (+ keep pattern in B2C for public) |
| `src/admin-auth/**` (DSA scope roles/permissions) | **COMMON_INFRA** / shared permissions catalogue |

**Must not contain:** supplier secrets, platform-wide DSA creation, APL pricing authority, cross-DSA access.

---

## APLAdmin Backend (target ownership)

APLAdmin auth/session, DSA onboarding/status, DSA admin provisioning, master services, `isAllowedByAPL`, supplier catalog + credential refs, DSA supplier assignment, platform pricing + ceilings, all bookings/payments/refunds oversight, request logs, platform audit, settings/security.

| Path | Classification |
|------|----------------|
| `src/apl-admin/**` | **MOVES_APLADMIN** |
| `src/apl-admin/models/AplAdminUser.js` | **MOVES_APLADMIN** |
| `src/apl-admin/models/AplAdminSession.js` | **MOVES_APLADMIN** |
| `src/apl-admin/controllers/dsas.controller.js` | **MOVES_APLADMIN** |
| `src/apl-admin/controllers/services.controller.js` | **MOVES_APLADMIN** |
| `src/apl-admin/controllers/suppliers.controller.js` | **MOVES_APLADMIN** |
| `src/apl-admin/controllers/pricing.controller.js` | **MOVES_APLADMIN** |
| `src/apl-admin/controllers/bookings.controller.js` | **MOVES_APLADMIN** |
| `src/apl-admin/controllers/dashboard.controller.js` | **MOVES_APLADMIN** |
| `src/tenant/services/dsa.service.js` | **MOVES_APLADMIN** (create/suspend) |
| `src/tenant/services/master-service.service.js` | **MOVES_APLADMIN** |
| `src/tenant/services/dsa-service-mapping.service.js` | **MOVES_APLADMIN** / shared with DSA activate path |
| `src/tenant/models/Dsa.js`, `Service.js`, `DsaService.js` | **MOVES_SHARED** contract |
| `src/suppliers/services/supplier-catalog.service.js` | **MOVES_APLADMIN** |
| `src/payments/services/ops-booking.service.js` | **MOVES_APLADMIN** |
| `src/admin-auth/**` | **MOVES_APLADMIN** + DSAAdmin consume shared Permission catalogue |

---

## Shared domain (already / must stay aligned)

| Concern | Location today | Target |
|---------|----------------|--------|
| Enums / statuses | `packages/shared-domain/constants/**` | **MOVES_SHARED** |
| `isServiceOffered` | `packages/shared-domain/rules/service-offer.js` | **MOVES_SHARED** |
| Tenant spoof keys | `packages/shared-domain/tenant/**` | **MOVES_SHARED** |
| Serialization guards | `packages/shared-domain/security/**` | **MOVES_SHARED** |
| Ownership / field contracts | `packages/shared-domain/contracts/**` | **MOVES_SHARED** |
| Pricing RULE_KINDS | shared package (wired from pricing-engine) | **MOVES_SHARED** |
| Payment status vocab | shared package (wired from `src/payments/status.js`) | **MOVES_SHARED** |

---

## Remains common / needs decision

| Item | Decision needed |
|------|-----------------|
| Mongoose model class files | Keep duplicated thin models per repo **or** move into `@apl/shared-domain` with mongoose peerDep |
| Index / migration runner | Single designated runner (recommended) |
| `ServiceLog` writers | B2C writes; APL reads; DSA limited |
| Redaction utilities | Prefer shared-domain security helpers |
| Seed/bootstrap scripts | Stay with the backend that owns the collection writes |

---

## Extraction order (recommended)

1. **15E** — Extract DSAAdmin API process (routes under `/api/dsa-admin`), keep same DB; depend on `@apl/shared-domain`  
2. **15F** — Extract APLAdmin API process  
3. Point frontends at new origins/ports only after dual-run verification  
4. Leave B2C travel API in APLTravelBackEnd  

**Not in scope yet:** frontend origin changes, new repos, real suppliers/payments.

---

## Verification gate before each extract

- Shared-domain tests green  
- Phase 15C multi-DSA isolation green  
- No confidential commercial leakage in DSAAdmin/B2C serializers  
- Field authority on `DsaService` preserved  
