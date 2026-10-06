# APL Travel — Full Project Context for AI Assistants

**Document purpose:** Give ChatGPT / Cursor / any new AI agent deep, accurate context about everything built so far on the APL Travel B2C portal and Node backend. Read this **before** proposing architecture changes or writing code.

**Last updated:** 2026-10-04 (evening session handoff)  
**Owner intent:** Multi-tenant travel platform (APL company → DSAs → B2C/B2B websites → end customers). Admin portals (DSAAdmin, APLAdmin) are **proposed but not implemented yet**. This document covers what **exists and works today**, plus the approved direction for admins.

---

## 1. Product vision (north star)

APL Travel is becoming a white-label / multi-DSA travel platform:

```
APLAdmin (company super-admin)     ← NOT BUILT YET
        ↓
   DSA / Client account
        ↓
DSAAdmin (per-DSA portal admin)    ← NOT BUILT YET
        ↓
B2C / B2B website                  ← EXISTS (single-tenant B2C today)
        ↓
End customer
```

**Today’s live product** is a **single-tenant B2C** site (“APL Travel”) talking to one Express backend on Render, one MongoDB Atlas database. There is **no** `dsaId`, tenant isolation, or admin RBAC in production code yet. Those were architected in a planning session and await explicit approval before coding.

---

## 2. Repositories and local disk layout

| Role | Local path | GitHub | Deploy |
|------|------------|--------|--------|
| B2C frontend | `/Users/rohandalal/Developer/AplTech/travelweb/b2c-travel` | https://github.com/ROHANKUMARDALAL/APL-Travel | Local Next on `:3001`; Vercel later |
| Backend (canonical) | `/Users/rohandalal/Developer/AplTech/APLTravelBackEnd` | https://github.com/ROHANKUMARDALAL/APLTravelBackEnd | Render: `https://apltravelbackend.onrender.com` |
| Backend (working clone) | `/Users/rohandalal/Developer/AplTech/travelBackend` | Same remote as APLTravelBackEnd | Local Node often on `:3000` |

**Important:** Prefer editing / pushing **`APLTravelBackEnd`** for GitHub + Render. The `travelBackend` folder is often a parallel checkout of the same repo.

**Latest commits at handoff:**

- Frontend `main`: `53af1c5` — *Lock live fare pricing and booking UX to the Render API.*
- Backend `main`: `3aadc44` — *Resolve flight checkout fare from selected family and paying pax.*

---

## 3. Non-negotiable operating rules

These are enforced by Cursor rule `.cursor/rules/live-backend-db.mdc` and by the product owner:

1. **B2C `.env.local` must use live Render**  
   `BACKEND_ORIGIN=https://apltravelbackend.onrender.com`  
   Do **not** point Next at `localhost` backend unless that local backend’s `MONGODB_URI` is the **same MongoDB Atlas URI** as Render.

2. **One shared live database for day-to-day work**  
   Login, travellers, bookings, searches for the B2C site must hit the **live** MongoDB via Render. Do not create a separate local-only user DB for normal development.

3. **After backend fare/booking changes:** push `APLTravelBackEnd` `main` and ensure Render **Manual Deploy** if auto-deploy is off, before telling the user to test live.

4. **Flight `confirmPrice` formula (exact):**  
   `(selectedFareQuote.unitAmount × payingPassengers) + selectedAddOns`  
   Paying passengers = adults + children; **infants excluded**.  
   Add-on codes/amounts on the frontend must match backend catalogue `src/flight/data/addons.js`.

5. **Do not break** existing Postman `/api/v1` contracts, mock suppliers, or B2C booking math when adding admin features.

6. **Never call supplier APIs from the Next.js frontend.** Only same-origin `/api/v1/...` (rewritten to Render).

---

## 4. Stack summary

### B2C frontend
- **Next.js 16.3.5** (App Router), **React 19**, mostly JSX + some TSX
- Dev: `npm run dev` → **port 3001**
- Tailwind CSS 4, fonts Fraunces + Manrope
- No NextAuth; custom client session
- API via `fetch('/api/v1/...')` + Next rewrites

### Backend
- **Node.js ≥ 20**, Express 5, Mongoose 8, plain JavaScript
- Default port **3000**, API prefix **`api/v1`**
- Auth: opaque login tokens (not JWT)
- Suppliers: mock adapters (TBO, TRIPJACK, KAFILA) — placeholders for real APIs later
- Response envelope: `{ success, error, data, meta.requestId }`

### Database
- **MongoDB Atlas** in production (URI only on Render env / local `.env`, never in git)
- Local fallback sometimes: `mongodb://127.0.0.1:27017/apl_travel` (separate DB — avoid for B2C UI testing)

---

## 5. How B2C talks to the backend

### Rewrite (`next.config.mjs`)
```js
BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "https://apltravelbackend.onrender.com"
// /api/v1/:path*  →  ${BACKEND_ORIGIN}/api/v1/:path*
```

### Client (`lib/api/client.js`)
- `apiGet`, `apiPost`, `apiPatch`, `apiDelete`
- Optional `Authorization: Bearer <loginToken>`
- Returns `payload.data` from the envelope
- Errors should be stringified for UI (avoid `[object Object]`)

### Env
- Only significant frontend env: **`BACKEND_ORIGIN`**
- `.env.local` is gitignored; `.env.example` documents Render URL

---

## 6. B2C frontend architecture (what exists)

### Routes (`app/`)

| Route | Purpose |
|-------|---------|
| `/` | Home / Dashboard search |
| `/login`, `/signup` | Auth + captcha |
| `/flights`, `/hotels`, `/buses`, `/transfers` | Results |
| `/flights/details`, `/hotels/details`, `/buses/details`, `/transfers/details` | Booking details + travellers |
| `/checkout` | Payment + confirm |
| `/booking-confirmation` | Confirmation + e-ticket preview/PDF |
| `/my-trips`, `/my-trips/[reference]` | Account bookings |
| `/find-booking` | Guest lookup |
| `/account`, `/account/travellers`, `/account/wallet`, `/account/referral` | Account area |
| `/support` | Support UI (mostly mock) |
| `/offers/[service]/[id]`, `/notes/[id]` | Static content stories |

### Services (hardcoded today — not CMS)

In `data/static.js`:
```js
SERVICES = [
  { id: "flight", label: "Flight", icon: "plane" },
  { id: "hotel", label: "Hotel", icon: "hotel" },
  { id: "bus", label: "Bus", icon: "bus" },
  { id: "transfer", label: "Transfer", icon: "transfer" },
]
```

Also wired through `lib/searchQuery.js` (`SERVICE_IDS`, results paths).  
**Future admin work** should eventually drive this from API; **do not rename** these IDs casually (breaks URLs and drafts).

### Live vs mock inventory

| Service | Search | Book |
|---------|--------|------|
| Flight | Live `POST /flights/search` | Live checkout + book |
| Hotel | Live `POST /hotels/search` | Live checkout + book |
| Bus | **Backend mocks** (`MOCKBUS_A` / `MOCKBUS_B`) | Phase 14A — `/api/v1/buses/*` |
| Transfer | **Backend mocks** (`MOCKXFER_A` / `MOCKXFER_B`) | Phase 14B — `/api/v1/transfers/*` |

### Auth (`lib/auth.js`, `components/auth/useAuth.js`)
- Session key: `apl-auth-session` in `localStorage`
- Stores user profile + `loginToken` (never password)
- `login` → `POST /auth/login` (email, password, captcha)
- `signUp` → `POST /auth/signup`
- `ensureValidSession` / `GET /auth/me`
- Captcha: `GET /auth/captcha`
- Event: `apl-auth-change` for UI sync

### Booking flow (high level)
1. Home search → results URL with query params  
2. Results: flights/hotels hit live API; cache via `rememberCatalog` / search results cache  
3. Details: fare family selection, travellers (saved travellers API), extras  
4. Draft in `localStorage` (`apl-booking-draft`)  
5. Checkout: mock payment UI (`lib/mockPayment.js`) then live `bookFlightStay` / `bookHotelStay`  
6. Confirmation + optional `POST /bookings/claim`  
7. My Trips: `GET /bookings`, `GET /bookings/:ref`  
8. E-ticket PDF: `lib/ticketPdf.ts`

### Pricing (critical — do not “simplify”)

**Frontend helpers:**
- `lib/fareSelection.js` — `payingPassengerCount`, `computeFlightConfirmPrice`, `withSelectedFare`, `selectedFareSnapshot`
- `lib/api/booking.js` — `bookFlightStay`, `bookHotelStay`
- `lib/booking.js` — `BOOKING_EXTRAS`, `mapFlightAddOns`, `calcBookingTotals`
- `lib/checkoutPricing.js` — payable breakdown; **flight service fee forced to 0** so UI matches API `confirmPrice`

**Flight confirmPrice:**
```
confirmPrice.amount =
  (selectedFareQuote.unit × payingPax) + sum(selected add-ons)
```
- Unit comes from selected fare family’s quote (Saver / Publish / Flexi / Corporate when API returns them)
- Add-ons mapped to backend codes: seats `12A`/`14F`, baggage `BG15`/`BG30`, meals `VGML`/`NVML` with **INR** amounts matching backend

**Hotel confirmPrice:**
```
confirmPrice.amount = roomQuote.amount × payingGuests
```
(no extras in current hotel API path)

### Fare families — important history

Backend can **expand** a single supplier fare into:
- SAVER ×1  
- PUBLISH ×1.08  
- FLEXI ×1.18  
- CORPORATE ×1.26  

Implemented in `src/flight/utils/offer-consolidation.js` (`expandFareFamilies`) and used in search consolidation + flight details.

**Frontend previously invented Flexi client-side** when API returned only Saver → caused **price mismatch** against Render.  
**Current frontend rule:** only show fares present in API `flightFareData` (`lib/api/mappers.js` `ensureFareOptions`). Do **not** reintroduce synthetic Flexi on the client.

**Deploy caveat:** If Render is behind GitHub `main`, live search may still return only SAVER until **Manual Deploy**. Local backend running latest code returns all four families.

### CMS / branding today (static)
- Brand name text “APL Travel” in Header/Footer (`data/static.js` `FOOTER`)
- Policies: `data/policies.js` (terms, privacy, cancellation, delivery) via PolicyModal
- Offers, notes, testimonials, FAQs: static files
- No logo image asset in `public/` for brand (text mark)
- Markets/currency: `data/markets.js` (INR primary)

### Key frontend directories
```
app/                 routes
components/          auth, booking, checkout, results, trips, ui
lib/                 auth, booking, fareSelection, api/*, ticketPdf
data/                static.js, policies.js, markets.js, mock/*
.cursor/rules/       live-backend-db.mdc
docs/                this file
```

---

## 7. Backend architecture (what exists)

### Entry
- `src/server.js` — connect Mongo, listen  
- `src/app.js` — middleware + route mounts  

### Middleware stack
helmet → request-id → morgan → CORS → JSON 1mb → service log → rate limit → routes → notFound → errorHandler

### Route mounts (do not break)
| Mount | Module |
|-------|--------|
| `GET /health` | liveness |
| `GET /ready` | dependency readiness |
| `/api/v1/suppliers` | suppliers |
| `/api/v1/hotels` | hotel |
| `/api/v1/flights` | flight |
| `/api/v1/auth` | user auth |
| `/api/v1/account` | account |
| `/api/v1/travellers` | travellers |
| `/api/v1/bookings` | bookings |

**`/api/v1/buses`** mounted (Phase 14A). See `docs/BUS_ARCHITECTURE.md`.  
**`/api/v1/transfers`** mounted (Phase 14B). See `docs/TRANSFER_ARCHITECTURE.md`.  
**No** `/api/dsa-admin` or `/api/apl-admin` yet (planned).

### Auth model
- **Not JWT**
- Token format: `lgn_<hex>`
- Stored as SHA-256 hash in `loginsessions`, TTL ~30 days
- Password: scrypt (`salt:hash`)
- Captcha: in-memory Map (`captcha.service.js`)
- Middleware: `requireLogin`, `optionalLogin` (`src/common/middleware/require-login.js`)
- Header: `Authorization: Bearer <token>` or `x-login-token`
- **No roles** on `User` — B2C traveller only (name, email, phone, currency, wallet `balance`)

### Flight vertical (core OTA slice)
1. Validate search (`flight.validation.js`)  
2. Call mock supplier adapters in parallel  
3. Store raw payloads (`SupplierRawPayload`)  
4. Normalize → entity resolution → consolidate under `aplFlightId`  
5. `expandFareFamilies` when single fare  
6. Markup layer (`DEFAULT_MARKUP_PERCENT`)  
7. Details / revalidate / checkout / book  

**Checkout pricing** (`src/flight/services/flight-booking.service.js`):
- `resolveSelectedFare` — match family by label or unit amount from `selectedFareQuote`
- `resolveUnitFareAmount` — prefer client selected family unit when accepted / relaxed
- `payingTravellerCount` — exclude INFANT
- `quoteFlightPrice` — unit × paying + add-ons
- `assertExactPrice` — must match `confirmPrice` exactly (currency + amount)
- Persists `chargedUnitAmount`, `fareLabel`, `selectedFareQuote` on checkout `offerSnapshot`

**Add-ons catalogue** (`src/flight/data/addons.js`): seats, baggage, meals with INR prices.

### Hotel vertical
Similar pattern: cities search, hotel search, details, revalidate, checkout, book. City codes numeric. Rooms + optional extra services on hotel side.

### Booking cross-product
- `Booking` + `Payment` models  
- `aplBookingRef` like `APL-BK-...` (frontend may also show `TRV-...` client refs in places — check claim flow)  
- `services` Mixed folders for hotel/flight (and bus-shaped claim data in some paths)  
- List/cancel/claim under `/api/v1/bookings`  
- Itinerary + fare breakdown on booking details (`checkout-booking.service.js`)

### Errors
- `AppError` + numeric `ErrorCode`  
- Envelope via `sendSuccess` / error handler  
- Hand-written validators (no Zod/Joi)

### Config / env (backend)
| Variable | Notes |
|----------|--------|
| `MONGODB_URI` | Required |
| `PORT` | Default 3000 |
| `API_PREFIX` | Default `api/v1` |
| `CORS_ORIGINS` | Comma list; empty → permissive |
| `THROTTLE_*` | Rate limit |
| `DEFAULT_MARKUP_PERCENT` | Pricing |
| `MOCK_SUPPLIER_FAILURES` | Partial failure testing |
| `TBO_*` / `TRIPJACK_*` / `KAFILA_*` | Placeholders |
| `ALLOW_DYNAMIC_FARE_AMOUNTS` / `USE_MOCK_SUPPLIERS` | Affect fare acceptance relaxation |

**No JWT secrets.**

### Postman
- Collection under `APLTravelBackEnd/postman/`
- Booking guide: `postman/BOOKING_GUIDE.md`
- Header for supplier failure simulation: `X-Simulate-Supplier-Failure: KAFILA`

---

## 8. MongoDB collections (current)

| Collection | Model | Purpose |
|------------|-------|---------|
| `users` | User | B2C customers |
| `loginsessions` | LoginSession | Opaque tokens |
| `savedtravellers` | SavedTraveller | Per-user travellers |
| `accountactions` / accountactions | AccountAction | Wallet ledger-ish actions |
| `bookings` | Booking | Confirmed bookings |
| `payments` | Payment | Mock payments |
| `checkoutsessions` | CheckoutSession | Pre-book tokens |
| `searches` | Search | Cached search results |
| `servicelogs` | ServiceLog | Request/supplier logs |
| `suppliers` | Supplier | Supplier registry |
| `suppliermappings` | SupplierMapping | Entity mapping |
| `supplierrawpayloads` | SupplierRawPayload | Layer A raw |
| `hotels` | Hotel | Hotel entities/offers |
| View `bookingServices` | — | Created on connect |

**No** DSA / Service master / CMS / AplAdmin collections yet.

---

## 9. Multi-tenant / admin status

### Exists today
- Single brand B2C
- Single user table for travellers
- No `dsaId` on bookings or users

### Proposed (architecture approved in planning; **not coded**)
Documented in the conversation ending 2026-10-04. Summary:

**Three frontends:** B2C (existing) + **DSAAdmin** (new Next app) + **APLAdmin** (new Next app).  
**One backend:** extend `APLTravelBackEnd` with:
- `/api/apl-admin/...`
- `/api/dsa-admin/...`
- `/api/v1/public/site` (later for B2C CMS)

**New models (planned):** `Dsa`, `Service` (master), `DsaService` (mapping with `isAllowedByAPL` + `isActiveByDSA`), `AplAdmin`, `DsaAdmin`, `Role`, sessions, `WebsiteSettings`, `Blog`, `Testimonial`, `FooterLink`, `CmsPage`, `AuditLog`.

**Service offer rule:**
```
offered =
  globalService ACTIVE
  AND dsa ACTIVE
  AND isAllowedByAPL
  AND isActiveByDSA
```

**Hard rules for future admin work:**
1. Do not break B2C or `/api/v1` search/book  
2. Do not put admin roles on B2C `User`  
3. Tenant `dsaId` from authenticated DSAAdmin session, never trust client body  
4. DSAAdmin and APLAdmin = **separate codebases**, not one Next app with route prefixes  
5. Implement only after explicit approval; module-by-module  

---

## 10. What was built / fixed recently (session history)

Use this so a new AI does not “rediscover” or reverse these fixes:

1. **Payment UI + e-ticket** redesign on B2C (checkout summary, PDF, preview).  
2. **Price mismatch** when selecting Flexi while Render only charged Saver — root cause was client-side synthetic fares vs undeployed/older Render build.  
3. Backend: accept `selectedFareQuote`, expand fare families, persist charged fare on booking itinerary.  
4. Frontend: `confirmPrice` = fare × paying pax + add-ons; extras catalogue aligned to backend codes; flight mock service fee removed from payable.  
5. Frontend: **stop inventing** fare families locally; only API fares.  
6. **Live DB rule:** B2C always → Render URL for shared Atlas data (login/travellers/bookings persist).  
7. Sync script exists: `APLTravelBackEnd/scripts/sync-local-mongo-to-live.js` (needs Atlas URI from Render env).  
8. Both repos pushed to GitHub before overnight break.  
9. Admin dual-portal architecture **proposed and stopped at Phase 6** pending user approval — **do not start coding admins until approved again**.

### Known ops debt
- Render may need **Manual Deploy** of latest `main` for fare families on live.  
- Bus Phase 14A: backend mock suppliers + B2C wired to `/api/v1/buses` (see `docs/BUS_ARCHITECTURE.md`).  
- Wallet/referral/support partially mock.  
- Homepage CMS static until public site-config API exists.

---

## 11. Local development commands

### Backend
```bash
cd /Users/rohandalal/Developer/AplTech/APLTravelBackEnd
cp .env.example .env   # set MONGODB_URI
npm install
npm run start:dev      # http://localhost:3000
```

### B2C
```bash
cd /Users/rohandalal/Developer/AplTech/travelweb/b2c-travel
# .env.local:
# BACKEND_ORIGIN=https://apltravelbackend.onrender.com
npm install
npm run dev            # http://localhost:3001
```

### Health checks
```bash
curl https://apltravelbackend.onrender.com/health
curl https://apltravelbackend.onrender.com/ready
curl -X POST https://apltravelbackend.onrender.com/api/v1/flights/search \
  -H 'Content-Type: application/json' \
  -d '{"origin":"DEL","destination":"BOM","departDate":"2026-11-01","adults":1,"cabinClass":"ECONOMY","currency":"INR"}'
```

---

## 12. Files that are dangerous to “refactor casually”

### Frontend — treat as contracts
- `lib/api/booking.js`, `lib/fareSelection.js`, `lib/booking.js` (add-on codes)
- `lib/auth.js`, `lib/api/client.js`
- `next.config.mjs` (BACKEND_ORIGIN rewrite)
- `.env.local` / live-backend rule

### Backend — treat as contracts
- `src/flight/services/flight-booking.service.js` (confirmPrice)
- `src/common/utils/price-confirm.js` (`assertExactPrice`)
- `src/common/services/checkout-booking.service.js`
- `src/flight/utils/offer-consolidation.js`
- `src/app.js` mounts and `/api/v1` paths
- `src/user/services/auth.service.js` / `require-login.js`

Safe additive areas for admins later: new `src/apl-admin`, `src/dsa-admin`, `src/tenant`, `src/cms` + new mounts **before** `notFoundHandler`.

---

## 13. Response / API conventions for new work

- Keep existing envelope and error codes for `/api/v1`.  
- New admin APIs may reuse envelope for consistency.  
- Validate inputs server-side.  
- Never return `passwordHash`, raw tokens, supplier secrets, or env values.  
- Prefer opaque hashed sessions (same pattern) for admin auth, with **separate** collections and token prefixes.

---

## 14. Suggested reading order for a new AI

1. This document  
2. `.cursor/rules/live-backend-db.mdc`  
3. `APLTravelBackEnd/src/app.js`  
4. `APLTravelBackEnd/README.md` + Postman booking guide  
5. `b2c-travel/lib/api/booking.js` + `lib/fareSelection.js`  
6. `b2c-travel/lib/auth.js` + `next.config.mjs`  
7. `b2c-travel/data/static.js` (hardcoded SERVICES / FOOTER)  
8. If working on admins: re-read the Phase 1–6 architecture proposal from the prior chat (DSAAdmin / APLAdmin) and **wait for explicit “approved, start coding”**

---

## 15. Owner preferences (process)

- Work in **phases**; stop for review when asked.  
- Do **not** generate hundreds of files unprompted.  
- Prefer production-oriented design without over-engineering.  
- Explain **why** for architectural decisions.  
- Inspect code before assuming.  
- Keep DSAAdmin and APLAdmin as **two separate Next.js apps**.  
- APLAdmin is parent/super-admin; DSAAdmin is tenant-scoped.  
- Eventually B2C should read services/branding/CMS from backend dynamically — **not** yet wired.

---

## 16. Quick glossary

| Term | Meaning |
|------|---------|
| APL | Parent company / platform |
| DSA | Downstream agent / client company that gets its own portal + site |
| `aplFlightId` / `aplFareId` | Canonical APL identifiers after consolidation |
| `confirmPrice` | Exact amount client must send; server recomputes and asserts equality |
| `selectedFareQuote` | Unit fare + label for chosen family (Flexi etc.) |
| `loginToken` | Opaque B2C session token (`lgn_…`) |
| Layer A/B/C | Raw supplier → normalized → APL consolidated offers |
| Render | Hosted backend + connection to Atlas |

---

*End of handoff document. If anything in live code disagrees with this file, trust the code and update this document.*
