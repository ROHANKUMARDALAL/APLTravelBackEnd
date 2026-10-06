# Admin API namespace plan

## Existing (unchanged)

`/api/v1/...` — B2C travel APIs. **Do not break.**

## Namespaces

| Namespace | Audience |
|-----------|----------|
| `/api/apl-admin/...` | APLAdmin |
| `/api/dsa-admin/...` | DSAAdmin |
| `/api/v1/public/...` | Public site config |

## Auth (Phase 4)

- APLAdmin / DSAAdmin: `POST .../auth/login|logout`, `GET .../auth/me`
- DSAAdmin sessions attach `req.tenant = { dsaId, dsaCode, source: 'session' }`

## APLAdmin Core (Phase 5)

Dashboard, DSA CRUD/status, master services, `isAllowedByAPL` mapping endpoints (see prior Phase 5 section).

## DSAAdmin Core (Phase 6) — tenant-self only

No `:dsaId` in routes. Tenant always from authenticated session.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/dsa-admin/dashboard` | Real service stats only (no fake bookings/revenue) |
| GET | `/api/dsa-admin/profile` | Own DSA + admin identity |
| PATCH | `/api/dsa-admin/profile` | Contact/display fields only; cannot change `dsaCode` / status |
| GET | `/api/dsa-admin/services` | Catalogue + mapping + availability reason + `effectiveOffered` |
| PATCH | `/api/dsa-admin/services/:serviceId` | Body: `{ isActiveByDSA }` only; `isAllowedByAPL` rejected |

### Ownership

- **APLAdmin:** `isAllowedByAPL`, global service status, DSA platform status
- **DSAAdmin:** `isActiveByDSA` (only when APL-allowed and globally active)

### Transaction tenancy (Phase 9)

- `/api/v1/flights/*`, `/api/v1/hotels/*`, `/api/v1/bookings/*` resolve trusted DSA from host (same public resolver).
- NEW `Booking.dsaId` / Search / ServiceLog / SupplierRawPayload attribution — no historical backfill.
- Offer rule enforced on flight/hotel transactional routes.
- Details: `docs/TRANSACTION_TENANCY.md`.

### Supplier platform (Phase 10) — APLAdmin only

| Method | Path | Permission |
|--------|------|------------|
| GET/POST | `/api/apl-admin/suppliers` | `supplier.view` / `supplier.manage` |
| GET/PATCH | `/api/apl-admin/suppliers/:id` | `supplier.view` / `supplier.manage` |
| PUT | `/api/apl-admin/suppliers/:id/services` | `supplier.manage` |
| GET/PUT | `/api/apl-admin/supplier-assignments` | `supplier.view` / `supplier.assign` |
| DELETE | `/api/apl-admin/supplier-assignments/:id` | `supplier.assign` |
| GET | `/api/apl-admin/request-logs` | `requestlog.view` |
| GET | `/api/apl-admin/request-logs/:requestId` | `requestlog.view` |

- Secrets never returned (only `credentialRef` + `credentialsConfigured`).
- DSAAdmin has **no** supplier catalog / platform request-log access.
- Details: `docs/SUPPLIER_PLATFORM.md`, `docs/OBSERVABILITY.md`.

### Pricing / commercial (Phase 12) — APLAdmin

| Method | Path | Permission |
|--------|------|------------|
| GET/POST | `/api/apl-admin/pricing/rules` | `pricing.view` / `pricing.manage` |
| GET/PATCH | `/api/apl-admin/pricing/rules/:id` | `pricing.view` / `pricing.manage` |
| POST | `/api/apl-admin/pricing/preview` | `pricing.view` |

### Pricing / markup (Phase 12) — DSAAdmin (tenant-self)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/dsa-admin/pricing/rules` | `markup.view` |
| GET | `/api/dsa-admin/pricing/ceiling` | `markup.view` |
| PUT | `/api/dsa-admin/pricing/markup` | `markup.manage` |
| POST | `/api/dsa-admin/pricing/preview` | `markup.view` |

Details: `docs/PRICING_ENGINE.md`.

### Bookings / payments (Phase 13) — APLAdmin

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/apl-admin/bookings` | Filters: q, dsaId, status, productType, paymentStatus, from, to |
| GET | `/api/apl-admin/bookings/:aplBookingRef` | Full ops detail (safe fields) |
| GET | `/api/apl-admin/payments` | Payment inspection |
| GET | `/api/apl-admin/refunds` | Refund inspection |

### Bookings (Phase 13) — DSAAdmin (tenant-self)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/dsa-admin/bookings` | Scoped to session DSA only |
| GET | `/api/dsa-admin/bookings/:aplBookingRef` | DSA commercial fields only |

### Deferred

- Real supplier credentials / live Flight adapter (Phase 11B — blocked)
- Real payment gateway integration (adapter contract documented in Phase 13)
- Tenant-scoped DSAAdmin log visibility (optional later)

## Public site (Phase 8)

Tenant resolved from Host / `X-Forwarded-Host` (dev: `X-APL-Public-Host` + `PUBLIC_DEV_HOST_MAP`).  
Never trust query/body `dsaId`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/public/site/config` | Public-safe branding, contact, social, seo, effective services, footer, testimonials, banners, page index, blogs index |
| GET | `/api/v1/public/site` | Alias of site/config |
| GET | `/api/v1/public/blogs` | Published blogs only |
| GET | `/api/v1/public/blogs/:slug` | Published blog detail |
| GET | `/api/v1/public/pages/:slug` | Published CMS page detail |

Env:

- `PUBLIC_TENANT_BASE_DOMAIN` — production subdomain base
- `PUBLIC_DEV_HOST_MAP` — non-production only (`host=DSA_CODE,...`)

Details: `docs/PUBLIC_SITE_ARCHITECTURE.md`.

## DSAAdmin CMS (Phase 7) — tenant-self only

Tenant always from authenticated session (`req.tenant.dsaId`). Client-supplied `dsaId` is ignored/stripped.

| Method | Path | Permission |
|--------|------|------------|
| GET/PATCH | `/api/dsa-admin/website-settings` | `branding.view` / `branding.manage` |
| GET/POST | `/api/dsa-admin/blogs` | `blog.view` / `blog.create` |
| GET/PATCH/DELETE | `/api/dsa-admin/blogs/:id` | `blog.view` / `blog.update` / `blog.delete` |
| GET/POST | `/api/dsa-admin/testimonials` | `testimonial.view` / `testimonial.manage` |
| PATCH/DELETE | `/api/dsa-admin/testimonials/:id` | `testimonial.manage` |
| GET/POST | `/api/dsa-admin/footer-links` | `footer.view` / `footer.manage` |
| PATCH/DELETE | `/api/dsa-admin/footer-links/:id` | `footer.manage` |
| GET/POST | `/api/dsa-admin/cms-pages` | `cms.view` / `cms.manage` |
| PATCH/DELETE | `/api/dsa-admin/cms-pages/:id` | `cms.manage` |
| GET/POST | `/api/dsa-admin/banners` | `cms.view` / `cms.manage` |
| PATCH/DELETE | `/api/dsa-admin/banners/:id` | `cms.manage` |
| POST | `/api/dsa-admin/media/upload` | any of branding/blog/testimonial/cms manage (or blog create/update) |

### Models / collections

- `WebsiteSettings` — unique per `dsaId`
- `Blog` — unique `(dsaId, slug)`
- `Testimonial`
- `FooterLink`
- `CmsPage` — unique `(dsaId, slug)`
- `Banner`

### Media strategy

- Abstraction: `src/common/media/storage.js`
- Development: local disk `uploads/dsa/{dsaId}/{purpose}/...` served at `/media/...`
- Production: swap storage implementation for object storage; keep `/media/...` (or CDN) URL contract
- Validation: JPEG/PNG/WebP/GIF/ICO only, max 2MB, purpose required

### Public delivery (Phase 8)

- Helper: `src/cms/services/public-site-config.service.js` → `buildPublicSiteConfig`
- Resolution: `src/public-site/services/resolve-tenant.service.js`
- Draft/inactive content is never publicly exposed
- B2C wires via `lib/site/config.js` + `SiteProvider`

## Service filters

Bookings, payments, refunds, request logs, suppliers, and pricing admin endpoints accept `TRANSFER` (and `BUS`) alongside Flight/Hotel. No Transfer-only admin pages were added in Phase 14B.

