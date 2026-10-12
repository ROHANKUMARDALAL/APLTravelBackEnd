# Multi-tenant B2C website

One B2C frontend (`b2c-travel`, port 3001) and one B2C backend (`APLTravelBackEnd`, port 3000) serve every DSA. Tenant identity is the browser host, not a client-supplied `dsaId`.

## Flow

```
Browser host (abc.localhost:3001 or abc.com)
  → B2C Next.js proxy sets X-APL-Public-Host / X-Forwarded-Host
  → B2C backend normalizes the host
  → match Dsa.domain, Dsa.customDomains, or Dsa.subdomain
  → DSA must be ACTIVE and website credential must not be REVOKED
  → req.tenant.dsaId
  → WebsiteSettings + effective services + CMS
  → public /api/v1/public/site/config
```

Search, booking, payment, and cancellation routes use the same host resolver. Client `dsaId`, `X-DSA-ID`, and query tenant ids are stripped and never become authority.

## Authority

| Actor | May |
|---|---|
| APLAdmin | Create the initial domain/subdomain, override domain, suspend the DSA, rotate or revoke the website credential |
| DSAAdmin | Edit its own domain, display name, and rotate its own credential. Session `dsaId` only. Cannot edit another DSA or lift an APL suspension |
| B2C | Read the resolved tenant. No tenant picker |

Effective service:

`global service active AND isAllowedByAPL AND isActiveByDSA`

## Website credential

Stored on `Dsa.websiteAccess` as `tokenHash` (SHA-256), `tokenPrefix`, `status`, `createdAt`, `rotatedAt`.

The raw `dsa_web_…` value is returned once on generate/rotate to the authenticated admin. Public config, logs, and later reads show only `dsa_web_abcd••••••••`.

Domain remains the customer identity. The credential status is the extra server-side gate: `REVOKED` or DSA `SUSPENDED` closes the website and travel APIs. A credential that has not been issued yet does not block an otherwise active domain.

## Domains

- Stored lowercase, without protocol, path, or `www.`
- Ports kept only for local hosts
- `domain` and `subdomain` are unique
- `customDomains` cannot repeat the primary domain or another DSA

Local:

- `http://{subdomain}.localhost:3001`
- Bare `http://localhost:3001` only if `PUBLIC_DEV_HOST_MAP` explicitly maps that host

Unknown hosts return 404. The site shows **Website Not Configured**. There is no production fallback tenant.

Suspended DSAs return 403. The site shows **Website Temporarily Unavailable**.

## Cache

Public config responses send `Cache-Control: private, max-age=5`.

The B2C server fetch uses `next.revalidate = 5` and includes `siteHost` in the URL, so tenants do not share a cache entry. A DSAAdmin save is visible on the next request, normally within 5 seconds.

## Code map

| Piece | Location |
|---|---|
| Host normalize | `src/public-site/utils/host.js` |
| Tenant resolve | `src/public-site/services/resolve-tenant.service.js` |
| Public config | `GET /api/v1/public/site/config` |
| Transaction tenant | `src/tenant/middleware/require-transaction-tenant.js` |
| B2C host forward | `b2c-travel/proxy.js` |
| B2C config fetch | `b2c-travel/lib/site/config.js` |
| DSAAdmin website API | `DSAAdminBackEnd` `GET/PATCH /api/dsa-admin/website` |
| DSAAdmin UI | `DSAAdmin` `/website` |
| APLAdmin override | `APLAdminBackEnd` `/api/apl-admin/dsas/:id/website` |
