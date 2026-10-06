# Supplier Platform (Phase 10)

**Status:** Implemented  
**Scope:** Control plane only — no real/external supplier API integration (Phase 11).

## Control-plane flow

```
APLAdmin
  → Supplier Catalog (Supplier)
  → Supplier ↔ Service (SupplierService)
  → DSA ↔ Service ↔ Supplier (DsaSupplier + priority + strategy)
  → Supplier Routing Service (buildSupplierExecutionPlan)
  → Transaction Tenant Context (req.tenant.dsaId)
  → Flight/Hotel/Bus/Transfer adapters (mocks; Phase 10 routing)
```

## Collections

| Collection | Purpose |
|------------|---------|
| `suppliers` | Global catalog: stable `code`, status, TEST/LIVE capability, credential metadata only |
| `supplierservices` | Supplier ↔ master Service enablement |
| `dsasuppliers` | Per-DSA assignment: priority, enabled, routingStrategy |
| `suppliermappings` | Existing entity ID mapping (hotel/flight ids) — unchanged |

Secrets are **never** stored on Supplier documents. Only:

- `credentialRef` (e.g. env prefix `SUPPLIER_TBO`)
- `credentialsConfigured` (boolean metadata)

Production secret storage remains deployment infrastructure (env / secret manager). Phase 11 test credentials may use env vars.

## Routing

Central service: `src/suppliers/services/supplier-routing.service.js`

**Input:** `dsaId`, `serviceCode`, `operation`, optional `environment`  
**Output:** execution plan `{ mode, strategy, suppliers[] }`

Eligibility checks (all required):

1. Enabled `DsaSupplier` row for DSA + service
2. Supplier `status === ACTIVE`
3. Enabled `SupplierService` mapping
4. Environment allowed on supplier (`TEST` / `LIVE`)
5. Adapter registered for that service

Strategies (explicit on assignment): `PARALLEL` | `PRIORITY` | `FALLBACK`  
Phase 10 still fans out eligible mocks for observability; Phase 11 may short-circuit FALLBACK.

### Legacy / development fallback

Used **only** when `NODE_ENV !== production` and there are no eligible DSA assignments:

- mode: `LEGACY_MOCK_FANOUT`
- reason: `NO_DSA_SUPPLIER_ASSIGNMENTS_DEV_FALLBACK` or `NO_ELIGIBLE_SUPPLIERS_DEV_FALLBACK`

Production **never** fail-opens past DSA supplier restrictions.

## APLAdmin APIs

Namespace: `/api/v1/apl-admin` (authenticated + RBAC)

| Method | Path | Permission |
|--------|------|------------|
| GET/POST | `/suppliers` | `supplier.view` / `supplier.manage` |
| GET/PATCH | `/suppliers/:id` | `supplier.view` / `supplier.manage` |
| PUT | `/suppliers/:id/services` | `supplier.manage` |
| GET/PUT | `/supplier-assignments` | `supplier.view` / `supplier.assign` |
| DELETE | `/supplier-assignments/:id` | `supplier.assign` |
| GET | `/request-logs` | `requestlog.view` |
| GET | `/request-logs/:requestId` | `requestlog.view` |

DSAAdmin must not access these routes.

## Credential runtime (Phase 11A)

```
Supplier.credentialRef + environment (TEST|LIVE)
  → resolveSupplierCredentials()
  → process.env / secret manager
  → adapter options.credentials (in-memory only)
```

- Mongo stores **metadata only** (`credentialRef`, `credentialsConfigured`).
- APLAdmin returns metadata flags, never secret values.
- ServiceLog / SupplierRawPayload receive redacted payloads only.
- HTTP client redacts `Authorization` / API-key headers in safe meta.
- Configurable timeout: `SUPPLIER_HTTP_TIMEOUT_MS` (default 15000).

Real Flight SEARCH adapter (Phase 11B) is **not** registered until official supplier documentation + TEST credentials are provided.

See `docs/OBSERVABILITY.md` for lifecycle stages.

## Phase 14 service adapters (mocks)

| Service | Mock codes | Docs |
|---------|------------|------|
| Bus | `MOCKBUS_A`, `MOCKBUS_B` | `docs/BUS_ARCHITECTURE.md` |
| Transfer | `MOCKXFER_A`, `MOCKXFER_B` | `docs/TRANSFER_ARCHITECTURE.md` |

Routing remains shared (`buildSupplierExecutionPlan`). No service-specific router forks.

