# Admin Backend Architecture (Phase 15B — Design)

Status: **DESIGN APPROVED PENDING** — do not extract backends until this document is reviewed.

This document designs the move from one logical multi-namespace Node process to optional independent backend processes, while keeping **one MongoDB database per environment** and the business hierarchy unchanged.

---

## 1. Business hierarchy (unchanged)

```
APLAdmin  (platform authority)
    ↓
DSAAdmin  (one DSA / client)
    ↓
B2C       (that DSA’s customer portal)
    ↓
Customer
```

Technical backend separation **≠** business independence. APLAdmin remains parent authority.

---

## 2. Target technical architecture

```
B2C Frontend (:3001)     → B2C Backend (:3000) ─────────┐
DSAAdmin Frontend (:3002) → DSAAdmin Backend (:3012) ───┼→ SAME MongoDB (per env)
APLAdmin Frontend (:3003) → APLAdmin Backend (:3013) ───┘
```

Frontends never connect to MongoDB.

**Today (current implementation):** one process `APLTravelBackEnd` on `:3000` mounts:

| Namespace | Role |
|-----------|------|
| `/api/v1/*` | B2C + public site |
| `/api/dsa-admin/*` | DSAAdmin |
| `/api/apl-admin/*` | APLAdmin |
| `/health`, `/ready` | probes |

**Tomorrow (planned):** same HTTP contracts, optionally split into three Node apps that still point `MONGODB_URI` at the **same** database name for that environment.

---

## 3. Current backend audit (source of truth)

### B2C (`/api/v1`)

- Tenant resolution via host / `X-APL-Public-Host` + `PUBLIC_DEV_HOST_MAP`
- Customer auth, account, travellers
- Flight / Hotel / Bus / Transfer search → revalidate → checkout → book
- Payments initiation, cancellation/refund **requests**
- Public CMS/config reads (`/api/v1/public/...`)
- Media static (`/media`)
- Must **not** expose admin mutations or supplier secrets

### DSAAdmin (`/api/dsa-admin`)

- Auth sessions (`DsaAdminUser` / `DsaAdminSession`) + RBAC
- Trusted `dsaId` from session only
- Profile, dashboard
- Service activate/deactivate (`isActiveByDSA`) — cannot set `isAllowedByAPL`
- CMS: WebsiteSettings, Banner, Blog, Testimonial, FooterLink, CmsPage
- DSA markup within APL ceiling
- Own bookings (filter `Booking.dsaId === session.dsaId`)

### APLAdmin (`/api/apl-admin`)

- Auth sessions (`AplAdminUser` / `AplAdminSession`) + platform RBAC
- DSA CRUD / status
- Master services + DSA allow (`isAllowedByAPL`)
- Suppliers, mappings, DSA assignments, request logs
- Platform pricing + DSA ceilings
- All-platform bookings / payments / refunds visibility

### Shared / domain (must stay single-sourced)

- `src/tenant/services/service-offer.service.js` — effective service rule
- Tenant models: `Dsa`, `Service`, `DsaService`, `Counter`
- Supplier models + routing/credential resolver
- Pricing engine + `PricingRule`
- Booking / payment / refund models + ops services
- CMS models (DSA mutate, B2C read)
- Admin roles (`AdminRole`) + permission enum
- Readiness state, service logs, envelopes, password hashing

---

## 4. Same database rule

| Environment | B2C Backend | DSAAdmin Backend | APLAdmin Backend | Database |
|-------------|-------------|------------------|------------------|----------|
| Development | → | → | → | **one** Mongo DB (e.g. `apl_travel`) |
| Production | → | → | → | **one** production Mongo DB |

Do **not** create `b2c_database` / `dsaadmin_database` / `apladmin_database`.

Environment separation = different URI / DB name. Portal separation = **not** via separate DBs.

---

## 5. Collection ownership

Use **current Mongoose models** as the contract. Extra collections allowed only when a real gap appears.

### Shared / Core

`dsas`, `services`, `dsaservices`, `counters`

### Supplier

`suppliers`, `supplierservices`, `dsasuppliers`, (+ mappings as modeled today)

### Transactions (primarily B2C write; admins read scoped)

`users`, `loginsessions`, `savedtravellers`, `searches`, `checkoutsessions`, `bookings`, `payments`, `cancellationrequests`, `refunds`, `accountactions`

### CMS (DSAAdmin write; B2C public read)

`websitesettings`, `banners`, `blogs`, `testimonials`, `footerlinks`, `cmspages`

### Pricing

`pricingrules` — APL owns platform/ceiling kinds; DSA owns own `DSA_MARKUP` within ceiling

### Auth (portal-specific)

`apladminusers`, `apladminsessions`, `dsaadminusers`, `dsaadminsessions`, `adminroles`

### Operations

`servicelogs`, `supplierrawpayloads` (+ admin action logs as implemented)

**New collections proposed now:** none. Extract backends first; add collections only for genuine gaps (e.g. dedicated audit if needed later).

---

## 6. Shared schema / contract strategy

**Recommended (simplest safe):** keep a shared internal package (or monorepo folder) of:

1. Mongoose models for shared collections  
2. Enums / status constants  
3. `isServiceOffered` / `evaluateServiceOffer`  
4. Password + opaque-token helpers used by admin auth  
5. Response envelope / AppError shapes that APIs already expose  

Options considered:

| Option | Verdict |
|--------|---------|
| Copy-paste models into 3 repos | **Reject** — schema drift risk |
| Full microservice mesh + schema registry | **Overkill** now |
| Shared npm/Git package `apl-travel-domain` (or `packages/domain` in monorepo) | **Recommend** |
| Single remaining monolith until ops force split | Valid interim; already true today |

**Rule:** one definition of `Booking`, `DsaService`, `PricingRule`, etc. All backends depend on that package at the same semver. Breaking field changes require coordinated release.

---

## 7. Proposed DSAAdmin Backend

**Boundary:** one authenticated DSA; never platform-wide.

**Owns HTTP:** `/api/dsa-admin/*` (port proposal `:3012`)

**Responsibilities:**

- Login / logout / me / session  
- RBAC for DSA roles  
- Profile / branding CMS / service activation  
- Markup ≤ ceiling  
- Own bookings / permitted payment views / reports  

**Must not:**

- Trust body/query `dsaId`  
- Set `isAllowedByAPL`  
- Read supplier secrets or APL internal margins  
- See other DSAs’ data  

---

## 8. Proposed APLAdmin Backend

**Boundary:** platform parent.

**Owns HTTP:** `/api/apl-admin/*` (port proposal `:3013`)

**Responsibilities:**

- APL auth + RBAC  
- DSA lifecycle + domain/subdomain  
- Master services + DSA allow/revoke  
- Supplier catalogue, credentials refs, assignments, routing priority  
- Platform pricing + ceilings  
- All bookings/payments/refunds/request logs / needs-attention  

**Must not:** leak secrets to other portals’ APIs.

---

## 9. B2C Backend relationship

**Do not redesign B2C unnecessarily.** Keep `/api/v1` behavior.

B2C continues to:

- Resolve tenant from host  
- Evaluate `isServiceOffered` from shared DB  
- Read CMS written by DSAAdmin  
- Apply pricing engine using APL + DSA rules  
- Deny service APIs when not offered  

Suggested port when split: keep B2C Backend on **`:3000`** for least frontend churn.

---

## 10. Control flows

### Effective service

```
Effective =
  Service.globalStatus === ACTIVE
  AND Dsa.status === ACTIVE
  AND DsaService.isAllowedByAPL
  AND DsaService.isActiveByDSA
```

Single helper: `service-offer.service` (shared package after split).

### APL → DSA → B2C (Flight)

1. APLAdmin Backend sets `isAllowedByAPL=true`  
2. DSAAdmin Backend reads mapping; owner sets `isActiveByDSA=true`  
3. B2C Backend evaluates offered → Flight searchable  
4. APLAdmin sets `isAllowedByAPL=false`  
5. DSAAdmin shows restricted; cannot override  
6. B2C Flight API rejected  

### CMS

DSAAdmin → WebsiteSettings/Blog/… → same Mongo → B2C `/api/v1/public/site/config` → website.

### Pricing

APLAdmin writes APL markup + DSA ceiling → DSAAdmin writes DSA markup ≤ ceiling → B2C pricing engine computes customer price. DSAAdmin preview strips confidential APL margin detail unless explicitly permitted.

---

## 11. Proposed backend repository names

Naming convention observed: `APLTravelBackEnd`, frontend repos `*FrontCode`.

| Proposed repo | Maps to |
|---------------|---------|
| **DSAAdminBackEnd** | DSAAdmin API process |
| **APLAdminBackEnd** | APLAdmin API process |
| `APLTravelBackEnd` (existing) | Remains B2C-focused backend (or shared host during migration) |

Optional later: `APLTravelDomain` / `apl-travel-domain` for shared models.

**Do not create these repos until design is approved and migration step starts.**

---

## 12. Proposed development ports

| Process | Port | Notes |
|---------|------|-------|
| B2C Backend | **3000** | Keep current; frontends already default here |
| DSAAdmin Backend | **3012** | Mirrors frontend 3002 |
| APLAdmin Backend | **3013** | Mirrors frontend 3003 |
| B2C Frontend | 3001 | unchanged |
| DSAAdmin Frontend | 3002 | unchanged |
| APLAdmin Frontend | 3003 | unchanged |

During migration, both admin frontends may keep `NEXT_PUBLIC_API_ORIGIN=http://localhost:3000` until cutover, then point to 3012/3013.

---

## 13. Safe incremental migration

| ID | Objective | Code | DB | Risk | Verify | Rollback |
|----|-----------|------|----|------|--------|----------|
| **15B.1** | Frontend repos | DSAAdmin / APLAdmin only | none | low | remotes pushed | N/A |
| **15B.2** | Backend audit + this design | docs only | none | none | review | N/A |
| **15B.3** | Shared schema contract | extract `domain` package **in-place** first | none | med | unit tests import package | revert package path |
| **15B.4** | DSAAdmin backend foundation | copy `dsa-admin`+CMS mutate+shared deps to new app; dual-run behind feature flag | same URI | med | DSAAdmin E2E vs same DB | frontends stay on :3000 |
| **15B.5** | APLAdmin backend foundation | same for `apl-admin` | same URI | med | APLAdmin E2E | frontends stay on :3000 |
| **15B.6** | Cross-backend integration | frontends → 3012/3013; B2C stays 3000 | same URI | med | allow→activate→revoke + CMS + pricing | flip origin env back |
| **15B.7** | Regression + hardening | readiness per process; ops docs | same URI | low | full smoke + lint/builds | redeploy monolith |

**Not big-bang.** Keep monolith routes until each new process proves parity.

---

## 14. Security boundaries

- Separate processes do not weaken RBAC  
- `dsaId` only from DSAAdmin session / B2C host resolution  
- No supplier secrets to B2C or DSAAdmin  
- No APL internal margins to DSAAdmin/B2C unless intentional  
- Dev bootstrap credentials never in frontend source or production UI  

---

## 15. Development test logins (local only)

Documented for local UI testing. **Not for production.** Recreate via bootstrap scripts if missing.

| Portal | Email | Password |
|--------|-------|----------|
| APLAdmin | `admin@apltravel.local` | `AplAdmin123!` |
| DSAAdmin | `owner@dsa.local` | `DsaAdmin123!` |

Bootstrap (env vars only; do not commit values):

- `scripts/bootstrap-apl-admin.js`
- `scripts/bootstrap-dsa-admin.js`

---

## 16. Decision gate

**STOP before implementation.** Next approved action after review:

→ **15B.3 Shared schema/contract package design + extraction plan**  
(not creating backend repos yet unless explicitly approved)
