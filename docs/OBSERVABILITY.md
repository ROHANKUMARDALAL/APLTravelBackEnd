# Observability (Phase 10)

**Status:** Implemented on top of existing `ServiceLog` + `SupplierRawPayload`.

## Lifecycle stages

One request is traced as multiple `ServiceLog` rows sharing `requestId` (+ `dsaId` when tenant-resolved):

| Stage | Meaning |
|-------|---------|
| `INBOUND_REQUEST` | Raw HTTP user/B2C request (middleware) |
| `NORMALIZED_REQUEST` | APL criteria after validation/normalization |
| `SUPPLIER_REQUEST` | Safe request prepared for a supplier branch |
| `SUPPLIER_RESPONSE` | Raw/sanitized supplier outcome for that branch |
| `NORMALIZED_RESPONSE` | Consolidated APL search result summary |
| `OUTBOUND_RESPONSE` | Final HTTP envelope returned to client |
| `ERROR` | Failed outbound / error envelope |

Fan-out creates one SUPPLIER_REQUEST + SUPPLIER_RESPONSE pair **per supplier**.

## Correlation

Every lifecycle row should carry where applicable:

- `requestId`
- `dsaId`
- `service` / `operation`
- `supplierCode` / `supplierId`
- `stage` / `status`
- `durationMs` / timestamps
- `payloadRef` → `SupplierRawPayload` for large bodies
- `errorCode` / `errorMessage`

## Payload storage

```
ServiceLog          → lifecycle metadata + small trimmed snapshot + payloadRef
SupplierRawPayload  → larger redacted payload (size-capped)
```

Limits (env):

- `SERVICE_LOG_INLINE_MAX_CHARS` (default 12000)
- `SUPPLIER_RAW_PAYLOAD_MAX_CHARS` (default 80000)

Redaction (`src/common/utils/redact.js`) runs **before** persistence.

Never logged: passwords, admin/B2C tokens, supplier credentials/API keys, card/CVV, payment secrets.

## Retention foundation

TTL indexes (operational logs only — **not** bookings/audit):

| Collection | Env | Default |
|------------|-----|---------|
| `servicelogs` | `SERVICE_LOG_RETENTION_DAYS` | 90 |
| `supplierrawpayloads` | `SUPPLIER_RAW_PAYLOAD_RETENTION_DAYS` | 30 |

Audit / booking records must not share these TTLs. Do not blindly delete production data outside configured TTL.

## APLAdmin Request Logs

- List/filter: requestId, DSA, service, operation, supplier, status, date range
- Detail: chronological timeline + expandable redacted JSON per stage / supplier branch
- Permission: `requestlog.view`
- DSAAdmin: **no** platform-wide supplier log access in Phase 10

## Flow

```
User Request
  → INBOUND_REQUEST
  → NORMALIZED_REQUEST
  → [per supplier] SUPPLIER_REQUEST → SUPPLIER_RESPONSE (+ raw payload refs)
  → NORMALIZED_RESPONSE
  → OUTBOUND_RESPONSE | ERROR
```


## Phase 12 pricing summary (safe)

Lifecycle NORMALIZED_RESPONSE may include `pricingVersion`.
Internal commercial snapshots live on Search (server), CheckoutSession, and Booking — not on public B2C fare payloads.
APLAdmin Request Logs remain the place for operational debugging; margin detail is not exposed to B2C/DSAAdmin request logs.

## Process probes (Phase 15)

- `GET /health` — liveness only
- `GET /ready` — Mongo + bootstrap readiness (`503` until ready)

See `docs/READINESS.md`.

