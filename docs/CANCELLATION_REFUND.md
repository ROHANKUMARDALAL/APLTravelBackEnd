# Cancellation & Refunds (Phase 13)

**Status:** Implemented with mock supplier cancel + mock refund.  
**No real airline/hotel penalty rules** — architecture is ready for supplier refund quotes later.

---

## Lifecycle

```
Booking CONFIRMED
  → CancellationRequest REQUESTED
  → PROCESSING (mock supplier cancel)
  → CONFIRMED | FAILED | REJECTED
  → Refund calculation from Booking.commercialSnapshot
  → Refund REQUESTED → PENDING → SUCCESS | FAILED
```

---

## CancellationRequest states

`REQUESTED` · `PROCESSING` · `CONFIRMED` · `REJECTED` · `FAILED`

Fields include: booking, dsaId, requestedBy, reason, supplierCancellationRef, requestId, idempotencyKey, refundId.

---

## Refund model

Supports `FULL` and `PARTIAL` kinds.

Uses **immutable** `Booking.commercialSnapshot` — never recalculates with today's pricing rules.

Mock rule: `DEV_FULL_SNAPSHOT_REFUND_NO_SUPPLIER_PENALTY`  
(`supplierPenalty = 0`; optional future `supplierQuote.refundableAmount` soft ceiling).

---

## Customer-visible statuses

| Internal | Customer |
|----------|----------|
| REQUESTED / PENDING | Refund processing / initiated |
| SUCCESS | Refund completed |
| FAILED | Refund failed |

Internal gateway/supplier debug details are not exposed to B2C.

---

## Ownership

- Customer: must own `Booking.userId`
- Tenant: `Booking.dsaId` must match website / DSAAdmin session
- APLAdmin: platform inspect (no default dangerous mutations)

---

## Partial refund foundation

Model ready (`kind=PARTIAL`, `requestedAmount` ≤ snapshot final price).  
Do not overbuild passenger/sector partial cancel until booking structure supports it safely.

See also: `docs/PAYMENT_ARCHITECTURE.md`.

## Product coverage

`FLIGHT`, `HOTEL`, `BUS`, and `TRANSFER` share Payment / Cancellation / Refund flows. Transfer uses the same mock payment and snapshot refund path (no Transfer-specific gateway or penalty matrix).

