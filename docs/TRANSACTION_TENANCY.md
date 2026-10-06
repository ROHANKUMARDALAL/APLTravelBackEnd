# Transaction Tenancy (Phase 9)

## Flow

```
Browser Host (DSA website)
  → B2C proxy.js injects X-APL-Public-Host / X-Forwarded-Host from inbound Host
  → Backend resolvePublicTenant (same Phase 8 resolver)
  → req.tenant = { dsaId, dsaCode, host, source }
  → Offer rule gate (flight/hotel)
  → Supplier routing (DSA → Service → assigned suppliers)
  → Search / supplier fan-out / ServiceLog lifecycle / SupplierRawPayload (dsaId + requestId)
  → CheckoutSession.dsaId
  → Booking.dsaId (from session — never from client)
  → Payment/confirm/cancel use Booking.dsaId ownership
```

## Trust rules

- **Never trust** client `dsaId` in query, body, or `X-DSA-ID`.
- Tenant identity comes from the **browser-facing host** resolved server-side.
- B2C `proxy.js` sets forwarding headers from the inbound Host to the B2C app (not from an arbitrary body field).
- Production: prefer `X-Forwarded-Host` / `Host` (edge/proxy). Dev: `X-APL-Public-Host` + `PUBLIC_DEV_HOST_MAP`.
- Production edge must overwrite/strip untrusted `X-Forwarded-Host` from the open internet.

## Correlation

- Client/proxy may send `x-request-id`; backend generates one when missing.
- Same `requestId` is stored on Search, SupplierRawPayload, ServiceLog lifecycle stages, Booking.
- Lifecycle stages: INBOUND → NORMALIZED → per-supplier SUPPLIER_* → NORMALIZED_RESPONSE → OUTBOUND/ERROR.
- `requestId` is correlation only — not an authorization or ownership secret.
- See `docs/OBSERVABILITY.md` and `docs/SUPPLIER_PLATFORM.md`.

## Legacy records

- Historical Users / Bookings / ServiceLogs / SupplierRawPayloads may lack `dsaId`.
- **No automatic backfill.**
- Code treats missing `dsaId` as legacy-safe for owner-scoped reads.
- After a booking has `dsaId`, later stages cannot change it; tenant mismatch → 403.

## Customer identity (hybrid direction)

- Phase 9 keeps global B2C `User` (email globally unique).
- Transaction ownership for DSA ops is `Booking.dsaId`.
- Future: Global User ↔ DSA membership (not implemented in Phase 9).

## Commercial snapshots (Phase 12)

NEW CheckoutSession / Booking may store `commercialSnapshot` (supplier/APL/DSA/fee/final).
Legacy bookings without snapshots remain valid — no invented backfill.

## Remaining gaps (later phases)

- Cryptographic offer tokens / stronger offer binding beyond Search.dsaId checks.
- Live/test Flight supplier adapter + env credentials (Phase 11).
- Real payment gateway adapter (contract ready — see `PAYMENT_ARCHITECTURE.md`)
- DSAAdmin booking UI (Phase 13 tenant bookings shipped; deeper ops in later phases)
