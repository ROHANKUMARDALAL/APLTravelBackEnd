# Common Supplier Gateway

The business name is Common CDN. The implementation is a multi-tenant supplier API gateway, not a static asset CDN.

Existing Supplier, SupplierService, DsaSupplier, routing (`PARALLEL`, `PRIORITY`, `FALLBACK`), mock adapters, domain resolution, and booking flows stay in place. The gateway adds tenant credential isolation, comparable-offer selection, and offer binding.

## Feature flag

`COMMON_SUPPLIER_GATEWAY_ENABLED=1` turns on tenant credential resolution and comparable-fare presentation inside flight search. Leave it unset until validated. Existing search and booking behavior stays unchanged while the flag is off.

## Ownership

- `APL`: the assignment uses deployment secrets resolved by `credentialRef`. Client secrets are not used.
- `CLIENT`: the assignment uses only that DSA’s encrypted `SupplierCredential`. It never falls back to APL or another DSA.
- `HYBRID`: a DSA may mix APL-owned and client-owned assignments. Each row still names one credential owner.

Unknown supplier APIs are placeholders. An API key does not create a live adapter. Official documentation and sandbox credentials are required.

## Security

- Secrets are AES-256-GCM ciphertext in `suppliercredentials`.
- Admin responses return `configured: true` only.
- `GATEWAY_CREDENTIAL_KEY` and `GATEWAY_INTERNAL_TOKEN` are environment variables, not database fields.
- Real supplier URLs must match `Supplier.allowedHosts` once a supplier is `READY`.
- Internal routes require the service token and `x-apl-tenant-dsa`. The browser does not call them.
- Booking checks the stored offer’s DSA, supplier, and credential reference when the flag is on.

## Environment

```
COMMON_SUPPLIER_GATEWAY_ENABLED=0
GATEWAY_PORT=3010
GATEWAY_INTERNAL_TOKEN=
GATEWAY_CREDENTIAL_KEY=
```

Use a 32-byte base64 key in deployment. Do not commit a real key.

## Operations

- Super Admin: `/supplier-gateway` on APL Admin.
- Registry and assignments remain `/suppliers` and `/supplier-assignments`.
- Request logs remain `/request-logs`.
- Standalone listener: `node src/common-supplier-gateway/server.js` on `127.0.0.1`.
- Rollback: set `COMMON_SUPPLIER_GATEWAY_ENABLED` empty and restart. Assignment rows and encrypted credentials can remain unused.

## Tests

```
node --test src/common-supplier-gateway/gateway.isolated.test.js
```

The test uses `mongodb://127.0.0.1:27018/apl_test_gateway_csg` and does not use the shared travel database.

## Supplier integration checklist

Do not register a live adapter until every item is available:

- Official supplier API documentation.
- Stable supplier code and adapter registration.
- Approved sandbox credentials, stored as ciphertext or deployment secrets.
- Request and response mapping into the common offer schema.
- Authentication flow, without hardcoded secrets.
- Search, price confirmation, and booking endpoints.
- Cancellation and refund support, or an explicit unsupported capability.
- Error mapping and timeout handling.
- Documented rate limits.
- Redacted supplier logging correlated by request ID.

## Not integrated yet

TBO, Travel Junction, and any new supplier still need official API documentation and approved sandbox credentials before a live adapter can replace the mock or placeholder. No production booking is performed by this gateway.
