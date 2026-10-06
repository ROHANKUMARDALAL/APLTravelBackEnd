# Bus Architecture (Phase 14A)

**Status:** Mock-supplier foundation complete.  
**Real Bus supplier:** Not implemented.  
**Phase 11B:** Remains BLOCKED (Flight live supplier).  
**Transfer:** Phase 14B complete — see `docs/TRANSFER_ARCHITECTURE.md`. Hotel live out of scope.

---

## End-to-end flow

```
B2C Bus Search (APL contract)
  → trusted DSA (host / X-APL-Public-Host)
  → Bus service offer authorization
  → POST /api/v1/buses/search
  → supplier router (Phase 10)
  → MOCKBUS_A + MOCKBUS_B adapters
  → normalize → safe consolidate → Phase 12 pricing
  → unified Bus results (aplBusId)
  → details / seat inventory (mock map)
  → revalidate
  → CheckoutSession (server price authority)
  → APL_MOCK_PAY
  → Booking CONFIRMED (service=BUS)
  → CancellationRequest → mock cancel → snapshot Refund
```

---

## Module layout

| Path | Role |
|------|------|
| `src/bus/routes/buses.routes.js` | HTTP surface |
| `src/bus/validators/bus.validation.js` | APL search/checkout/book contracts |
| `src/bus/services/bus-search.service.js` | Search, details, revalidate, seats |
| `src/bus/services/bus-booking.service.js` | Checkout / book / cancel |
| `src/bus/services/location.service.js` | APL location ids (`APL-LOC-*`) |
| `src/bus/suppliers/*` | Mock adapters + registry |
| `src/bus/utils/*` | Normalize / resolve / consolidate |

Reuses (no duplicates): tenant middleware, supplier router, pricing engine, CheckoutSession, Payment, Cancellation/Refund, ServiceLog / SupplierRawPayload, APLAdmin / DSAAdmin ops.

---

## APL Bus search contract (B2C-owned)

```json
{
  "origin": "New York",
  "destination": "Boston",
  "travelDate": "YYYY-MM-DD",
  "adults": 1,
  "children": 0,
  "currency": "INR"
}
```

Aliases accepted: `from`/`to`, `date`/`departDate`.  
Locations normalize to `{ aplLocationId, name, kind }` — never supplier city IDs.

---

## Location model

- Canonical: `APL-LOC-{SLUG}` (e.g. `APL-LOC-NEW-YORK`)
- Future: APL location ↔ supplier location mapping table (not exposed to B2C)
- Free-text city names are accepted today for mock routing

---

## Normalized Bus result (public)

| Field | Notes |
|-------|--------|
| `aplBusId` | Stable APL id (`APL-BUS-…`) |
| `operator`, `busType` | Display |
| `departure` / `arrival` | city, station, time, `aplLocationId` |
| `durationMinutes`, `amenities`, `seatsLeft` | |
| `offers[]` | `aplOfferId`, boarding/dropping points, **customer** `price` |
| `primaryOffer` | Cheapest offer for simple Select |
| `lowestPrice` | |

Stripped from public responses: `commercialSnapshot`, `supplierPrice`.  
Supplier codes may appear on offer refs for correlation; B2C identity is `aplBusId` / `aplOfferId`.

---

## Consolidation matching (safe)

Merge supplier candidates **only** when all match:

1. operator (case-insensitive)
2. origin `aplLocationId`
3. destination `aplLocationId`
4. departure time `HH:mm`
5. arrival time `HH:mm`
6. travel date

Prefer duplicate cards over incorrect merges.  
MOCKBUS_A/B intentionally overlap East Coast Express 07:30 NYC→BOS for tests.

---

## Mock suppliers

| Code | Role |
|------|------|
| `MOCKBUS_A` | Primary mock inventory |
| `MOCKBUS_B` | Second supplier + consolidation overlap |

Deterministic outcomes via `x-simulate-supplier-failure` / mock helpers: SUCCESS, EMPTY, FAILURE, TIMEOUT.

Adapter contract:

```
searchBuses(criteria, options) → { status, buses, rawPayload, durationMs, error? }
```

No real HTTP. Future live adapters implement the same surface and plug into Phase 10 routing.

---

## Pricing

Phase 12 engine only:

`supplier unit → APL markup → DSA markup (within ceiling) → service fee → discount → customer final`

Checkout multiplies unit customer price × selected seat count.  
Margins stay in `commercialSnapshot` (APLAdmin); not public B2C.

---

## Seats / boarding / dropping

- Mock seat map (deterministic taken seats) on `/buses/details`
- Checkout requires `selectedSeats`, `boardingPointCode`, `droppingPointCode`
- Persisted on CheckoutSession / Booking offer snapshot

Not a real operator seat-layout API.

---

## Checkout / payment / booking

- `CheckoutSession.productType = BUS`
- Charge = server `commercialSnapshot.finalPrice` / session pricing
- Payment = Phase 13 `APL_MOCK_PAY`
- Booking retains `dsaId`, `requestId`, supplier booking ref, journey + seats + commercialSnapshot
- Idempotent book / cancel / refund

---

## Cancellation / refund

Phase 13 path. Mock supplier cancel; refund from booking snapshot.  
No invented real bus penalty matrices (`DEV_FULL_SNAPSHOT_REFUND_NO_SUPPLIER_PENALTY`).

---

## Admin

- **APLAdmin:** filter bookings/payments/refunds/logs by `BUS`; Supplier → BUS mappings; DSA → BUS → supplier assignments; BUS pricing rules / ceilings
- **DSAAdmin:** tenant-scoped Bus bookings only; DSA markup within ceiling; no APL margins / supplier secrets

---

## Security

- Trusted `dsaId` from host — client cannot override
- Service offer: DSA active + Bus global + APL allowed + DSA active
- No supplier fail-open when DSA has no BUS assignments
- Cross-tenant / cross-customer denial on booking & cancel

---

## Future real Bus adapter contract

Implement:

1. `searchBuses(criteria, { credentials, timeoutMs, simulate })`
2. Optional later: `getSeatLayout`, `holdSeats`, `book`, `cancel`
3. Map supplier locations → APL locations in the adapter boundary
4. Register in `src/bus/suppliers/registry.js` + Supplier/SupplierService/DsaSupplier rows
5. Never expose supplier service IDs as B2C canonical ids

---

## B2C

Active path: `searchBuses` → results → details/seats → checkout → `bookBusStay` → cancel.  
Legacy `data/mock/buses.js` is no longer used by ResultsPage.
