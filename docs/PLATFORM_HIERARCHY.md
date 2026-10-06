# Platform Hierarchy (Phase 15B)

## Business control

```
APLAdmin  (platform authority)
    ↓
DSAAdmin  (one DSA / client)
    ↓
B2C       (that DSA's customer portal)
    ↓
Customer
```

Technical backend separation **does not** mean business independence.  
APLAdmin remains the parent authority.

## Technical shape (current)

```
                 SAME MONGODB (per environment)
                          ▲
             ┌────────────┼────────────┐
             │            │            │
      B2C API ns     DSAAdmin API   APLAdmin API
      /api/v1/*      /api/dsa-admin  /api/apl-admin
             ▲            ▲            ▲
             │            │            │
            B2C        DSAAdmin      APLAdmin
         (:3001)        (:3002)       (:3003)
```

**Current decision:** Keep **one** Node backend process (`APLTravelBackEnd` on `:3000`) with **logically separated** portal modules.  
Why: shared models, single effective-service rule, shared pricing/payments already work.

**Planned (pending approval):** optional physical split into B2C / DSAAdmin / APLAdmin backend processes that still share **one MongoDB per environment**. See `docs/ADMIN_BACKEND_ARCHITECTURE.md`. Do not extract until that design is approved.

## Parent → child control (shared DB)

```
APLAdmin allows Flight for DSA
  → DsaService.isAllowedByAPL = true

DSAAdmin activates Flight
  → DsaService.isActiveByDSA = true

B2C evaluates isServiceOffered(...)
  → Flight searchable when Global Active ∧ DSA Active ∧ APL Allow ∧ DSA Activate
```

Revoke path:

```
APLAdmin sets isAllowedByAPL = false
  → DSAAdmin cannot override
  → B2C Flight search denied (even if DSA still “active”)
```

## Effective service rule (single source)

```
Effective =
  Service.globalStatus === ACTIVE
  AND Dsa.status === ACTIVE
  AND DsaService.isAllowedByAPL
  AND DsaService.isActiveByDSA
```

Implementation: `src/tenant/services/service-offer.service.js`

## DSAAdmin → B2C branding

DSAAdmin mutates CMS collections (`WebsiteSettings`, banners, blogs, …).  
B2C public APIs read the same documents for the resolved tenant host.

## Security boundaries

| Portal | May do | Must not |
|--------|--------|----------|
| B2C | Customer travel + public CMS read | Admin mutations, secrets, APL margins |
| DSAAdmin | Own CMS, activate allowed services, own markup ≤ ceiling, own bookings | Cross-tenant access, supplier secrets, override APL allow |
| APLAdmin | Platform DSAs, services, suppliers, ceilings, all bookings/logs | Leak secrets to other portals |

Trusted `dsaId` always comes from session/host resolution — never from client-chosen body fields.
