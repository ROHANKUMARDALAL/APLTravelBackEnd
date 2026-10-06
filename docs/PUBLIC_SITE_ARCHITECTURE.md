# Public Site Architecture (Phase 8)

## Flow

```
Incoming Host / Domain
  → normalize (lowercase, strip protocol/www, keep local ports)
  → resolve ACTIVE DSA (domain | subdomain | dev host map)
  → buildPublicSiteConfig(dsa)
  → B2C renders branding + effective services + published CMS
```

## Production resolution

1. Read `X-Forwarded-Host` (CDN/proxy) or `Host`
2. Match `Dsa.domain` (unique when non-empty)
3. Or `{subdomain}.{PUBLIC_TENANT_BASE_DOMAIN}`
4. DSA must be `ACTIVE` (suspended → 403)

Client-supplied `dsaId` is **never** trusted.

## Local development resolution

Because `localhost` is shared, use **development-only** mapping:

```
PUBLIC_DEV_HOST_MAP=localhost:3001=APL-DSA-0034,127.0.0.1:3001=APL-DSA-0034
```

- Loaded only when `NODE_ENV !== production`
- B2C server sends `X-APL-Public-Host` / `X-Forwarded-Host` of the browser host when calling the API
- Production clears the map entirely

## Public APIs

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/public/site/config` | Full public-safe config |
| GET | `/api/v1/public/site` | Alias |
| GET | `/api/v1/public/blogs` | Published only |
| GET | `/api/v1/public/blogs/:slug` | Published only |
| GET | `/api/v1/public/pages/:slug` | Published only |

## Effective services

Uses central `listOfferedServicesForDsa` / offer rule. Fail closed on evaluation errors.

## B2C integration

- Travel APIs: `BACKEND_ORIGIN` (Render/Atlas — unchanged)
- Public site/CMS/media: optional `PUBLIC_SITE_ORIGIN` (local backend for Phase 8 CMS)
- Cache: Next `fetch` `revalidate: 30` seconds
- Fallback: branding/footer/testimonials may use static defaults; **tenant-mode services never fail open to static SERVICES**. If no tenant resolves, legacy single-brand mode keeps current marketing site usable.

## Booking / user tenancy (Phase 9+)

- **NEW** tenant-aware bookings store trusted `Booking.dsaId` from host-resolved context (via checkout session).
- Historical bookings/users may lack `dsaId` — **no automatic backfill**.
- Client `dsaId` is never authoritative. See `docs/TRANSACTION_TENANCY.md`.
- Customer identity remains globally unique for now (hybrid membership deferred).

## Travel API host forwarding (B2C)

Browser → B2C `proxy.js` → rewrites to `BACKEND_ORIGIN`.  
Proxy sets `X-APL-Public-Host` / `X-Forwarded-Host` from the inbound Host to the B2C app so transactional routes resolve the same DSA as public site config.

## Supplier logging

`requestId` middleware → envelopes → `ServiceLog` inbound/supplier outcomes with optional `dsaId` on new tenant-originated calls. Full normalized-stage UI/retention remains a later ops task.

## Production requirements remaining

- Object/media storage behind `/media`
- Real DNS custom domains + TLS
- `PUBLIC_TENANT_BASE_DOMAIN` + CORS for production hosts
- Deploy Phase 8 APIs to Render
- Historical booking tenant migration (separate)
- Production monitoring / log retention
