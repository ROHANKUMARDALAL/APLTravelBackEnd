# Transfer Architecture (Phase 14B)

**Status:** Mock-supplier foundation complete.  
**Real Transfer supplier:** Not implemented.  
**Phase 11B:** Remains BLOCKED (Flight live supplier).  
**Real Bus / Hotel / Payment gateway:** Out of scope for 14B.

---

## End-to-end flow

```
B2C Transfer Search (APL contract)
  → trusted DSA (host / X-APL-Public-Host)
  → Transfer service offer authorization
  → POST /api/v1/transfers/search
  → supplier router (Phase 10)
  → MOCKXFER_A + MOCKXFER_B adapters
  → normalize → conservative consolidate → Phase 12 pricing
  → unified Transfer results (aplTransferId)
  → details / revalidate
  → CheckoutSession (server price authority)
  → APL_MOCK_PAY
  → Booking CONFIRMED (service=TRANSFER)
  → CancellationRequest → mock cancel → snapshot Refund
```

---

## Module layout

| Path | Role |
|------|------|
| `src/transfer/routes/transfers.routes.js` | HTTP surface |
| `src/transfer/validators/transfer.validation.js` | APL search/checkout/book contracts |
| `src/transfer/services/transfer-search.service.js` | Search, details, revalidate |
| `src/transfer/services/transfer-booking.service.js` | Checkout / book / cancel |
| `src/transfer/services/location.service.js` | APL location ids (`APL-APT-*`, `APL-LOC-*`, …) |
| `src/transfer/suppliers/*` | Mock adapters + registry |
| `src/transfer/utils/*` | Normalize / resolve / consolidate |

Reuses (no duplicates): tenant middleware, supplier router, pricing engine, CheckoutSession, Payment, Cancellation/Refund, ServiceLog / SupplierRawPayload, APLAdmin / DSAAdmin ops.

---

## APL Transfer search contract (B2C-owned)

Supported route shapes (from location kinds):

- airport → hotel/address
- hotel/address → airport
- airport → airport
- city/address → city/address

```json
{
  "pickup": { "name": "Delhi Airport (DEL)", "kind": "AIRPORT", "code": "DEL" },
  "dropoff": { "name": "The Leela Palace Delhi", "kind": "HOTEL" },
  "pickupDate": "YYYY-MM-DD",
  "pickupTime": "HH:mm",
  "passengers": 2,
  "currency": "INR"
}
```

Aliases accepted: `date` / `travelDate`, flat `pickup`/`dropoff` strings with `pickupKind`/`dropoffKind`.  
Derived `transferType`: `AIRPORT_TRANSFER` when either end is `AIRPORT`, else `CITY_TRANSFER`.  
Optional at checkout only: `flightNumber`, `pickupInstructions` (not mandatory).

---

## Location model

Kinds: `AIRPORT` | `HOTEL` | `ADDRESS` | `CITY`

Canonical ids (APL-owned, never supplier IDs):

- Airport: `APL-APT-{CODE|SLUG}`
- City/hotel/address: `APL-LOC-{SLUG}`

Free-text names accepted for mocks. Future live adapters map supplier location codes → APL ids inside the adapter boundary.

---

## Normalized Transfer result (public)

| Field | Notes |
|-------|--------|
| `aplTransferId` | Stable APL id (`APL-XFER-…`) |
| `transferType` | `AIRPORT_TRANSFER` / `CITY_TRANSFER` |
| `vehicleCategory`, `vehicleName` | Display |
| `maxPassengers`, `maxLuggage` | Capacity |
| `pickup` / `dropoff` | `{ aplLocationId, name, kind, code? }` |
| `pickupDateTime`, `estimatedDurationMinutes` | |
| `inclusions`, `cancellationNote` | Safe customer copy |
| `offers[]` | `aplOfferId` + **customer** `price` |
| `primaryOffer` / `lowestPrice` | |

Stripped from public responses: `commercialSnapshot`, `supplierPrice`.  
Supplier codes may appear on offer refs for correlation; B2C identity is `aplTransferId` / `aplOfferId`.

---

## Consolidation matching (conservative)

Merge supplier candidates **only** when all match:

1. pickup `aplLocationId`
2. dropoff `aplLocationId`
3. `vehicleCategory`
4. `maxPassengers`
5. `transferType`
6. pickup date (`YYYY-MM-DD`)

Do **not** merge different vehicle classes or capacities just because the route matches.  
Prefer duplicate cards over incorrect merges.

---

## Mock suppliers

| Code | Role |
|------|------|
| `MOCKXFER_A` | Primary mock transfer inventory |
| `MOCKXFER_B` | Second supplier + consolidation overlap |

Deterministic outcomes via `x-simulate-supplier-failure` / mock helpers: SUCCESS, EMPTY, FAILURE, TIMEOUT.

Adapter contract:

```
searchTransfers(criteria, options) → { status, transfers, rawPayload, durationMs, error? }
```

No real HTTP. Future live adapters implement the same surface and plug into Phase 10 routing.

---

## Pricing

Phase 12 engine only:

`supplier unit → APL markup → DSA markup (within ceiling) → service fee → discount → customer final`

No Transfer-specific pricing rules engine.  
Margins stay in `commercialSnapshot` (APLAdmin); not public B2C.

---

## Checkout / payment / booking

- `CheckoutSession.productType = TRANSFER`
- Charge = server `commercialSnapshot` / session pricing (client price must match)
- Payment = Phase 13 `APL_MOCK_PAY`
- Booking retains `dsaId`, `requestId`, supplier booking ref, pickup/dropoff/vehicle + commercialSnapshot
- Optional `flightNumber` / `pickupInstructions` stored on offer snapshot for future suppliers
- Idempotent book / cancel / refund

---

## Cancellation / refund

Phase 13 path. Mock supplier cancel; refund from booking snapshot.  
No invented real transfer penalty matrices.

---

## Admin

- **APLAdmin:** filter bookings/payments/refunds/logs by `TRANSFER`; Supplier → TRANSFER mappings; DSA → TRANSFER → supplier assignments; TRANSFER pricing rules / ceilings
- **DSAAdmin:** tenant-scoped Transfer bookings only; DSA markup within ceiling; no APL margins / supplier secrets

---

## Security

- Trusted `dsaId` from host — client cannot override
- Service offer: DSA active + Transfer global + APL allowed + DSA active
- No supplier fail-open when DSA has no TRANSFER assignments (production)
- Cross-tenant / cross-customer denial on booking & cancel
- Client final price never authoritative

---

## Observability

Phase 10 lifecycle stages with `service=TRANSFER`:

`INBOUND_REQUEST → NORMALIZED_REQUEST → SUPPLIER_REQUEST → SUPPLIER_RESPONSE → NORMALIZED_RESPONSE → OUTBOUND_RESPONSE / ERROR`

Larger payloads: sanitized `SupplierRawPayload`.

---

## Future real Transfer adapter contract

Implement (when supplier docs + TEST credentials exist):

1. `searchTransfers(criteria, { credentials, timeoutMs, simulate })`
2. `revalidateOffer` / `book` / `cancel` behind the same adapter boundary
3. Map supplier locations → APL locations in the adapter
4. Register in `src/transfer/suppliers/registry.js` + Supplier / SupplierService / DsaSupplier rows
5. Never expose supplier service IDs as B2C canonical ids
6. Real cancellation penalties only from documented supplier rules

---

## B2C

Active path: homepage Transfer tab → `/transfers` results → `/transfers/details` → checkout → `bookTransferStay` → My Trips / cancel.  
No legacy static Transfer catalog.
