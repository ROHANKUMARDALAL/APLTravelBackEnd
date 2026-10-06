# Database Architecture (Phase 15B)

**Environment rule:** ONE MongoDB database per environment.  
**Current local DB:** `mongodb://127.0.0.1:27017/apl_travel`  
**Portal-specific databases:** Not used.

## Backend topology

### Current (logical separation, one Node process)

```
B2C Frontend (:3001) ──→ /api/v1/*              ─┐
DSAAdmin Frontend (:3002) ──→ /api/dsa-admin/*  ─┼→ APLTravelBackEnd (:3000) → MongoDB `apl_travel`
APLAdmin Frontend (:3003) ──→ /api/apl-admin/*  ─┘
```

### Planned (optional physical split — same DB; see `ADMIN_BACKEND_ARCHITECTURE.md`)

```
B2C Backend (:3000) ────────┐
DSAAdmin Backend (:3012) ───┼→ SAME MongoDB `apl_travel` (per environment)
APLAdmin Backend (:3013) ───┘
```

Frontends never connect to MongoDB directly.

Physical split is **designed, not implemented** yet. Ownership is already modular today:

| Portal | Backend module roots | HTTP namespace |
|--------|----------------------|---------------|
| B2C | `src/flight`, `src/hotel`, `src/bus`, `src/transfer`, `src/user`, `src/booking`, `src/public-site`, `src/payments` (customer) | `/api/v1/*` |
| DSAAdmin | `src/dsa-admin`, `src/cms` (tenant mutate) | `/api/dsa-admin/*` |
| APLAdmin | `src/apl-admin`, platform pricing/suppliers/tenant admin | `/api/apl-admin/*` |

Shared domain helpers (must stay single-sourced):

- `src/tenant/services/service-offer.service.js` — effective service rule
- Shared Mongoose models under `src/**/models` and `src/common/database/models`

## Collections by ownership

### Shared / Core (platform + tenant mapping)

| Collection | Primary mutator | Readers |
|------------|-----------------|---------|
| `dsas` | APLAdmin | All |
| `services` | APLAdmin | All |
| `dsaservices` | APLAdmin (allow) + DSAAdmin (activate) | All |
| `suppliers` | APLAdmin | APLAdmin; B2C via router only |
| `supplierservices` | APLAdmin | APLAdmin / routing |
| `dsasuppliers` | APLAdmin | APLAdmin / routing |
| `pricingrules` | APLAdmin (platform/ceiling) + DSAAdmin (own markup within ceiling) | Pricing engine / admins |

### B2C / Transactions

| Collection | Owner mutate | Notes |
|------------|--------------|-------|
| `users` | B2C | Customer accounts |
| `loginsessions` | B2C | |
| `savedtravellers` | B2C | |
| `searches` | B2C | |
| `checkoutsessions` | B2C | |
| `bookings` | B2C create; cancel/refund shared ops | `dsaId` required |
| `payments` | B2C initiate; APL oversight | |
| `cancellationrequests` | B2C / ops | |
| `refunds` | Ops / Phase 13 | |
| `accountactions` | B2C | |

### DSA / CMS

| Collection | Owner mutate | Readers |
|------------|--------------|---------|
| `websitesettings` | DSAAdmin | B2C public |
| `banners` | DSAAdmin | B2C public |
| `blogs` | DSAAdmin | B2C public |
| `testimonials` | DSAAdmin | B2C public |
| `footerlinks` | DSAAdmin | B2C public |
| `cmspages` | DSAAdmin | B2C public |

### Auth (portal-specific)

| Collection | Owner |
|------------|-------|
| `apladminusers`, `apladminsessions` | APLAdmin |
| `dsaadminusers`, `dsaadminsessions` | DSAAdmin |
| `adminroles` | Platform seed / APL |

### Operations

| Collection | Owner |
|------------|-------|
| `servicelogs` | All backends (write); APLAdmin read |
| `supplierrawpayloads` | Supplier adapters; APLAdmin read |

## Consistency rules

- Shared entities use one Mongoose model definition — do not fork schemas per portal.
- Prefer `dsaId`, `serviceId`, `supplierId`, `requestId` references over duplicated documents.
- Effective service availability always uses `isServiceOffered` — never reimplemented ad hoc.
- Environment separation = different Mongo URI / DB name (`apl_travel` vs production Atlas DB). Not portal DBs.

## Collections added in Phase 15B

None required — existing models already cover hierarchy, CMS, transactions, and admin auth.
