# Pricing Engine (Phase 12)

**Status:** Implemented  
**Phase 11B:** Remains BLOCKED (waiting for supplier docs/credentials). Phase 12 works with mock suppliers.

## Flow

```
Supplier base price (preserved)
  → Supplier commission (snapshot; usually 0)
  → APL markup
  → DSA markup (≤ APL ceiling)
  → Service fee
  → Discount (future-compatible)
  → Final customer price
  → Immutable commercialSnapshot on CheckoutSession / Booking
```

Percentages apply to the **supplier base** (not compounded). FIXED amounts require matching currency (no FX).

## Money / rounding

- All commercial math uses **integer minor units** (×100).
- Conversion: `Math.round(major * 100)` → calculate → `minor / 100`.
- Deterministic half-up via `Math.round`.

## Rule kinds

| Kind | Owner | Purpose |
|------|-------|---------|
| `APL_MARKUP` | PLATFORM | APL commercial markup |
| `DSA_MARKUP_CEILING` | PLATFORM | Max DSA markup allowed |
| `DSA_MARKUP` | DSA | DSA markup (enforced ≤ ceiling) |
| `SERVICE_FEE` | PLATFORM (typically) | Separated fee |
| `SUPPLIER_COMMISSION` | PLATFORM | Future-compatible (default 0) |
| `DISCOUNT` | PLATFORM/DSA | Future-compatible |

## Precedence (within one kind)

Most specific wins:

1. scope + service + supplier  
2. scope + service  
3. scope global  

DSA rules only apply to their `dsaId`. Platform ceilings/markups never use `dsaId`.

Inactive / out-of-date / wrong-service / wrong-supplier rules are ignored.

FIXED currency mismatch → adjustment skipped (`CURRENCY_MISMATCH`), not thrown.

## Public vs internal

- B2C search responses strip `supplierPrice` and `commercialSnapshot`.
- Search documents retain internals for checkout recalculation.
- DSA preview hides raw applied-rule internals beyond totals.
- APLAdmin preview can show full snapshot.

## Legacy

- Historical bookings without `commercialSnapshot` remain valid (no invented backfill).
- If no APL markup rules exist, `DEFAULT_MARKUP_PERCENT` remains a platform fallback.

## APIs

- APLAdmin: `/api/apl-admin/pricing/rules`, `/pricing/preview` (`pricing.view` / `pricing.manage`)
- DSAAdmin: `/api/dsa-admin/pricing/rules|ceiling|markup|preview` (`markup.view` / `markup.manage`)

## Services covered

Flight, Hotel, Bus, and Transfer all use the same Phase 12 engine (`serviceCode` = `flight` | `hotel` | `bus` | `transfer`). No product-specific pricing forks.

