# Payment Architecture (Phase 13)

**Status:** Implemented with mock provider only.  
**Phase 11B:** Remains BLOCKED (no real Flight supplier docs/credentials).

---

## Lifecycle

```
CheckoutSession (READY)
  → Payment Attempt (CheckoutSession.PAYING)
  → Payment SUCCESS | FAILED | PENDING
  → Booking Confirm Attempt
  → Booking CONFIRMED | FAILED (payment may already be SUCCESS)
```

Payment success is **not** equivalent to supplier/local booking confirmation.

---

## State machines

### Payment (`Payment.status`)

| State | Meaning |
|-------|---------|
| CREATED | Record created before provider call |
| PENDING | Provider returned pending (mock `FORCE_PENDING`) |
| SUCCESS | Funds captured (legacy `CAPTURED` / `AUTHORIZED` normalize to SUCCESS) |
| FAILED | Provider declined / failed |
| CANCELLED | Abandoned / voided |
| REFUND_PENDING | Refund submitted, awaiting provider |
| PARTIALLY_REFUNDED | Partial refund completed |
| REFUNDED | Full refund completed |

### Booking (`Booking.status`) — separate

`DRAFT` · `PENDING_PAYMENT` · `CONFIRMED` · `CANCELLED` · `FAILED`

### CheckoutSession extras

- `PAYING` — atomic claim during payment
- `PAYMENT_CAPTURED_BOOKING_FAILED` — recoverable ops state

---

## Provider abstraction

```
Payment Service
  → getPaymentProvider(code)
  → Adapter: createPayment / refundPayment
  → APL_MOCK_PAY (dev/test only)
  → Future: Razorpay / PayU / Cashfree / Stripe / …
```

Booking controllers never contain provider-specific logic.

### Real gateway adapter contract

A production adapter must implement:

1. `createPayment({ amount, currency, method, instrument, metadata })`  
   → `{ ok, status, providerRef, last4?, failureReason?, providerMeta? }`
2. `refundPayment({ amount, currency, providerRef, reason })`  
   → `{ ok, status, providerRefundRef?, failureReason?, providerMeta? }`

Optional later: `verifyPayment` / webhook handlers registered beside the adapter **without** changing Booking confirmation orchestration.

Never persist: CVV, full PAN, gateway secrets.

---

## Server-authoritative amount

Charge amount = `CheckoutSession.commercialSnapshot.finalPrice`  
(fallback: `session.pricing`).

Client `payment.amount` / tampered `confirmPrice` are rejected.

---

## Idempotency

| Boundary | Key |
|----------|-----|
| Payment capture | `idempotencyKey` unique on Payment (default `pay:{checkoutToken}`) |
| Checkout claim | Atomic `READY → PAYING` |
| Book replay | `CheckoutSession.BOOKED` returns existing booking |
| Cancellation | `idempotencyKey` unique (default `cancel:{ref}:{userId}`) |
| Refund | `refund:{bookingRef}:{cancellationRef}` unique |

---

## Failure recovery

| Case | Representation |
|------|----------------|
| Payment SUCCESS + booking FAILED | Payment `SUCCESS`, `bookingConfirmStatus=FAILED`, `needsAttention=true`, session `PAYMENT_CAPTURED_BOOKING_FAILED` |
| Cancellation SUCCESS + refund FAILED | Cancellation `CONFIRMED`, Refund `FAILED`, Payment `REFUND_PENDING` + `needsAttention` |
| Provider PENDING | Payment `PENDING` — not treated as success |
| Unknown / timeout | Keep provider refs; do not invent SUCCESS/FAILED |

---

## Tenant ownership

`Payment.dsaId`, `CancellationRequest.dsaId`, `Refund.dsaId` come from `CheckoutSession` / `Booking.dsaId` only.  
Client-supplied `dsaId` is ignored. DSA A cannot read DSA B financial records.

---

## Observability stages

`PAYMENT_CREATED` · `PAYMENT_SUCCESS` · `PAYMENT_FAILED`  
`BOOKING_CONFIRM_ATTEMPT` · `BOOKING_CONFIRMED` · `BOOKING_FAILED`  
`CANCELLATION_*` · `REFUND_*` via ServiceLog (redacted).

Admin inspections also write `AdminAuditLog`.

---

## Mock-only behaviour

- Cards ending `0000` → FAIL  
- `FORCE_FAIL` / `FORCE_PENDING` methods  
- `FORCE_REFUND_FAIL` reason  
- `simulateBookingFailure` for payment-success/booking-failure tests  
- Mock provider blocked in production config

## Product coverage

`FLIGHT`, `HOTEL`, `BUS`, and `TRANSFER` share Payment / Cancellation / Refund flows. Transfer uses the same mock payment and snapshot refund path (no Transfer-specific gateway or penalty matrix).

