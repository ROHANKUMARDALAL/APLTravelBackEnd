# Production Ops Checklist (Phase 15)

**Status:** Foundation  
**Related:** `docs/READINESS.md`, `docs/OBSERVABILITY.md`, `docs/ADMIN_API_NAMESPACE.md`

## Before traffic

1. MongoDB reachable from the app (`MONGODB_URI`).
2. Process liveness: `GET /health` → `200` / `alive: true`.
3. Dependency readiness: `GET /ready` → `200` (not `503`).
4. Do **not** admit traffic on PID-only checks.
5. Confirm env: `PUBLIC_DEV_HOST_MAP` / production host→DSA map, CORS, throttle limits.

## Probe wiring (Render / reverse proxy)

| Check | Path | Action on failure |
|-------|------|-------------------|
| Liveness | `/health` | Restart process |
| Readiness | `/ready` | Keep process, remove from load balancer until `200` |

## After deploy smoke

```bash
npm run wait:stack          # local stack
npm run smoke:travel        # Flight/Hotel/Bus/Transfer after /ready
```

Production equivalent: wait for `/ready`, then authenticated admin health + one search per active service.

## Failure classification

| Symptom | Meaning | Action |
|---------|---------|--------|
| Connection refused | Service unavailable / not started | Start process; do not treat as route bug |
| `/ready` 503 | Starting or dependency down | Check Mongo; wait with bounded backoff |
| API 404 with JSON `NOT_FOUND` | Real missing route | Investigate deploy/mount |
| API 5xx | Application/dependency error | Check logs / Mongo / supplier |

## Admin ops notes

- APLAdmin Request Logs: filter by `requestId`, service, DSA — never expect supplier secrets.
- DSAAdmin: tenant-scoped bookings only.
- Retention: ServiceLog / SupplierRawPayload TTLs — not bookings.
