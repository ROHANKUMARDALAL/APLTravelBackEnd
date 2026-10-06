# Multi-DSA Validation (Phase 15C)

**Status:** COMPLETED (2026-10-06)  
**Scope:** Prove APL → DSA → B2C hierarchy with **new** DSAs before physical backend split.  
**Backend shape during 15C:** still one Express process (`/api/v1`, `/api/dsa-admin`, `/api/apl-admin`) on **one MongoDB**.

---

## Test DSAs (development)

| | DSA A | DSA B |
|--|-------|-------|
| Name | E2E Demo Travel | E2E Sample Holidays |
| dsaCode | `APL-DSA-0094` | `APL-DSA-0095` |
| Domain | `e2e-demo.localhost` | `e2e-sample.localhost` |
| B2C host | `http://e2e-demo.localhost:3001` | `http://e2e-sample.localhost:3001` |
| Services (effective) | Flight + Bus | Hotel + Transfer |
| Branding | Demo Brand Portal | Sample Brand Portal |
| DSAAdmin email | `e2e.demo.admin@example.test` | `e2e.sample.admin@example.test` |

DSAAdmin temporary passwords are shown **once** at APLAdmin provision time (not stored plaintext). Re-provision / rotate via APLAdmin → DSA Detail → Admins if lost.

Bootstrap (unchanged):

| Portal | Email | Password |
|--------|-------|----------|
| APLAdmin | `admin@apltravel.local` | `AplAdmin123!` |
| Legacy DSAAdmin | `owner@dsa.local` | `DsaAdmin123!` |

---

## Onboarding flow (product path)

1. APLAdmin login  
2. `POST /api/apl-admin/dsas` → `dsaCode`, domain/subdomain  
3. `PATCH /api/apl-admin/dsas/:id/services/:serviceId` → `isAllowedByAPL`  
4. Optional: suppliers, platform pricing/ceiling rules  
5. **NEW:** `POST /api/apl-admin/dsas/:id/admins` → first DSAAdmin + one-time `temporaryPassword`  
6. DSAAdmin login → session `dsaId`  
7. Activate services, CMS, markup  
8. B2C host → `resolvePublicTenant` → config/search/book  

No Mongo hand-edits required for normal onboarding.

---

## Admin provisioning

| Item | Behavior |
|------|----------|
| API | `GET/POST /api/apl-admin/dsas/:id/admins` |
| Permission | `user.view` / `user.manage` |
| Binding | `DsaAdminUser.dsaId` fixed at create |
| Password | scrypt hash; plaintext returned **once** in response (`RESPONSE_ONCE_DEVELOPMENT`) |
| Email | not sent (no mailer wired) |
| UI | APLAdmin DSA Detail → **Admin Users** tab |

---

## Tenant host strategy (dev)

- Prefer `Dsa.domain` = `{slug}.localhost` (no app hardcoding)  
- B2C browser: `http://{slug}.localhost:3001`  
- Resolver: domain match; local hosts also match **without port**  
- `PUBLIC_DEV_HOST_MAP` still supported for `localhost:3001` defaults  
- Client `dsaId` stripped / ignored  

---

## Service matrix (Demo example)

| Service | Global | APL allow | DSA active | B2C |
|---------|--------|-----------|------------|-----|
| Flight | ACTIVE | YES | YES | visible |
| Hotel | ACTIVE | NO | — | hidden |
| Bus | ACTIVE | YES | YES | visible |
| Transfer | ACTIVE | NO | — | hidden |

Rule: `src/tenant/services/service-offer.service.js`  
Enforced on APIs via `requireOfferedService`.

---

## Isolation results

| Check | Result |
|-------|--------|
| CMS per host | PASS |
| Services per host | PASS |
| Pricing/markup tenant-scoped | PASS |
| Search/Booking `dsaId` | PASS |
| Client `dsaId` spoof | PASS (ignored) |
| Cross-DSAAdmin booking | PASS (denied/not listed) |
| APL sees booking | PASS |
| APL revoke Flight | PASS (DSA cannot override; B2C 403) |
| DSA suspend | PASS — **policy A: cannot login**; public 403 |

---

## Automated coverage

File: `src/tenant/services/multi-dsa-validation.integration.test.js`

Covers onboarding, provision, CMS spoof, host resolution, bus book + dsaId, isolation, revoke, suspension.

---

## Customer identity recommendation

**GLOBAL + MEMBERSHIP (Option C)**  

`User` is still globally unique by email with **no `dsaId`**. Bookings/searches already carry trusted `dsaId`. Adding `User.dsaId` would force duplicate accounts per DSA. Prefer keep global identity and add membership/context later if wallet/loyalty must be tenant-specific. **Not implemented in 15C** (no security break on booking isolation).

---

## Remaining gaps (non-blocking for 15C)

- Physical backend split still pending (15D+)  
- Real suppliers / real payments still mock  
- APLAdmin Users/Audit/Settings still mostly placeholders (DSA Admins tab now live)  
- Platform-wide ceiling rules cannot embed `dsaId` (by current pricing validation)  
- Production DNS/`PUBLIC_TENANT_BASE_DOMAIN` still ops work  

---

## Next phase (plan only — do not auto-start)

**15D — Shared Domain Contract** once 15C accepted.
