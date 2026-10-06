# Startup & Dependency Readiness (Phase 15)

**Status:** Implemented  
**Scope:** Generic operational readiness — not Transfer-specific.

## Problem

A process that has started is **not** the same as an application that is ready.  
Smoke checks that hit B2C/backend before Mongo init / listen complete can see connection failures or misleading proxy errors. Treat those as readiness timing issues, not product regressions.

## Probes

| Probe | Path | Meaning | Success |
|-------|------|---------|---------|
| Liveness | `GET /health` | Node process can answer HTTP | `200` + `alive: true` |
| Readiness | `GET /ready` | Mongo reachable + init complete + HTTP listening | `200` when ready; `503` when not |

`/health` must **not** require Mongo.  
`/ready` **must** require dependency readiness (Mongo ping + bootstrap flags).

### Readiness reasons

| `reason` | Meaning |
|----------|---------|
| `READY` | Accept traffic |
| `STARTING` | Process/bootstrap still incomplete |
| `NOT_READY` | Listening/init incomplete |
| `DEPENDENCY_UNAVAILABLE` | Database down / ping failed |

Scripts classify outcomes as:

- `UNAVAILABLE` — process not started / connection refused  
- `NOT_READY` — `503` from `/ready`  
- `ROUTE_NOT_FOUND` — real `404` (do not infinite-retry)  
- `SERVER_ERROR` — real `5xx`  
- `READY` — probe success  

## Bootstrap flags

Set by `src/server.js`:

1. `markDatabaseConnected` after Mongo connect  
2. `markInitComplete` after connection init (views/backfill)  
3. `markHttpListening` after `app.listen`

## Dev / CI scripts

| Script | Purpose |
|--------|---------|
| `npm run wait:stack` | Wait for Backend `/ready` + B2C + DSAAdmin + APLAdmin |
| `npm run dev:status` | One-shot status report with failure classification |
| `npm run smoke:travel` | Wait for `/ready`, then Flight/Hotel/Bus/Transfer search smoke (B2C proxy by default) |
| `npm run test:ready` | Readiness unit/integration tests |

Bounded retry/backoff applies only to `UNAVAILABLE` / `NOT_READY` (and short frontend warm-up). Genuine route `404` / hard failures fail fast.

## Verification sequence

```
Backend starting
  → GET /health 200 (alive)
  → GET /ready 503 (pending)
  → Mongo + init + listen
  → GET /ready 200
  → B2C proxy travel searches (Flight/Hotel/Bus/Transfer) → 200
```

## Production

Orchestrators / load balancers should:

- use `/health` for restart/liveness decisions  
- use `/ready` for traffic admission  

Do **not** treat “Node PID exists” as production readiness.
