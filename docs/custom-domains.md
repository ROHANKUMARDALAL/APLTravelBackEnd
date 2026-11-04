# Connecting a client domain after deployment

This application does not buy domains, change DNS, or issue certificates. Those steps happen only after the platform is hosted.

1. In APLAdmin, open the DSA and choose Domain & Website.
2. Assign the platform subdomain. That hostname is `{subdomain}.{PUBLIC_TENANT_BASE_DOMAIN}`.
3. Register the client's hostname. It is stored as `PENDING` and does not serve the site.
4. After the site is deployed, add the DNS records shown in APLAdmin:
   - CNAME the client hostname to the platform domain.
   - TXT `_apl-verify.{hostname}` with the displayed value.
5. Confirm DNS with your DNS provider. Then set the mapping to `VERIFIED`, and to `SSL_PENDING` while the certificate is requested.
6. Set `TRUST_PROXY=1` only on the application behind your reverse proxy. Leave it unset on a machine that is reached directly.
7. Set `PUBLIC_APP_URL`, `ALLOWED_PLATFORM_DOMAINS`, and `CORS_ORIGINS` to the real public origins. Leave `COOKIE_DOMAIN` empty so each website keeps host-only cookies.
8. When the certificate is installed, set the mapping to `ACTIVE` and choose it as primary. Until that status is saved, the hostname does not resolve to the DSA.
9. `DNS_SSL_PROVIDER` is a placeholder for a future provider. The application does not call one.

Unknown, disabled, and pending hostnames do not fall through to another DSA. `X-Forwarded-Host` is ignored unless `TRUST_PROXY=1`.
