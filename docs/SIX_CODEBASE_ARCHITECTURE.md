# Six-Codebase Architecture

**Status:** Phase 15E — DSAAdmin backend separation in progress  
**Database rule:** ONE MongoDB database per environment for all three backends  
**Shared contract:** `@apl/shared-domain` (`packages/shared-domain`)

---

## Target applications (exactly six)

| # | Codebase | Role | Local port |
|---|----------|------|------------|
| 1 | `APLTravelFrontend` | B2C customer UI | 3001 |
| 2 | `APLTravelBackEnd` | B2C / customer travel API only | 3000 |
| 3 | `DSAAdminFrontCode` | Tenant admin UI | 3002 |
| 4 | `DSAAdminBackEnd` | DSAAdmin API only | 3004 |
| 5 | `APLAdminFrontCode` | Internal platform UI | 3003 |
| 6 | `APLAdminBackEnd` | APLAdmin API only | 3005 |

```
APLAdminFrontCode → APLAdminBackEnd ──┐
DSAAdminFrontCode → DSAAdminBackEnd ──┼──→ SAME MongoDB (e.g. apl_travel)
APLTravelFrontend → APLTravelBackEnd ─┘
```

Backends are **independent processes/codebases**. The database is **shared infrastructure** controlled only by APL.

---

## Business hierarchy

```
APLAdmin → DSA/Tenant → DSAAdmin → B2C Website → Customer
```

- APLAdmin never ships inside customer-deliverable B2C code.
- DSAAdmin never manages another DSA.
- B2C never exposes admin/platform management APIs (after Phase 15G cleanup).

---

## Current repository mapping (local)

| Target name | Local path today | Git remote | Status |
|-------------|------------------|------------|--------|
| APLTravelFrontend | `travelweb/b2c-travel` | `ROHANKUMARDALAL/APL-Travel` | EXISTS (rename optional) |
| APLTravelBackEnd | `APLTravelBackEnd` | `ROHANKUMARDALAL/APLTravelBackEnd` | EXISTS (still hosts legacy admin mounts) |
| DSAAdminFrontCode | `DSAAdmin` | `ROHANKUMARDALAL/DSAAminFrontCode` | EXISTS |
| DSAAdminBackEnd | `DSAAdminBackEnd` | (new local repo) | CREATED in 15E |
| APLAdminFrontCode | `APLAdmin` | `ROHANKUMARDALAL/APLAdminFrontCode` | EXISTS |
| APLAdminBackEnd | — | — | PLANNED (15F) |

---

## Shared MongoDB

- Env var: `MONGODB_URI` (same URI / same DB name for all three backends in an environment)
- **Do not** create `apl_b2c_db` / `apl_dsa_db` / `apl_admin_db`
- No DB sync / dual-write between databases

### Production DB role strategy (document now; do not force in local/dev)

| Backend | Intended privilege shape |
|---------|--------------------------|
| APLAdminBackEnd | Broad platform read/write |
| DSAAdminBackEnd | Collections required for tenant admin (no supplier secret collections if splitable) |
| APLTravelBackEnd | Runtime/transaction + required reads of platform config |

Local/dev may continue using a single Mongo user. Customers/DSAs never receive Mongo credentials.

---

## Shared domain / models

- Package: `@apl/shared-domain`
- Owns enums, tenant spoof contract, `isServiceOffered`, ownership matrix, serialization helpers
- **Canonical Mongoose schemas** for shared collections live under `packages/shared-domain/models` (Phase 15E+)
- Application backends must not drift independent schema copies

### Field authority (example)

`DsaService`:

| Field | Writer |
|-------|--------|
| `isAllowedByAPL` | APLAdminBackEnd only |
| `isActiveByDSA` | DSAAdminBackEnd only |
| Evaluate offer | All backends (read) |

---

## Strangler migration

1. Build new backend process  
2. Run both (legacy mount + new process)  
3. Test new backend  
4. Switch frontend API origin  
5. Verify same-DB hierarchy effects  
6. Deprecate old routes  
7. Remove old routes in 15G (B2C cleanup) / after 15F for APL  

### Phase gates

| Phase | Scope |
|-------|--------|
| **15E** | Create `DSAAdminBackEnd`, extract `/api/dsa-admin`, switch DSAAdmin FE |
| **15F** | Create `APLAdminBackEnd`, extract `/api/apl-admin` |
| **15G** | Strip admin namespaces from `APLTravelBackEnd` |

---

## Multi-DSA

Same frontend + backend **code** for all DSAs; isolation via host / session / `dsaId` / config. Never one codebase per DSA.

---

## Customer identity

Direction: **GLOBAL USER + DSA MEMBERSHIP** (design only; not required for 15E).
