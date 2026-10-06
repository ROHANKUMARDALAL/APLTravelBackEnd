# Local development — six codebases

Startup order:

1. MongoDB (`apl_travel`)
2. APLTravelBackEnd `:3000`
3. DSAAdminBackEnd `:3004`
4. APLAdminBackEnd `:3005`
5. B2C frontend `:3001`
6. DSAAdmin frontend `:3002`
7. APLAdmin frontend `:3003`

All three backends **must** use the same `MONGODB_URI` database name (local: `mongodb://127.0.0.1:27017/apl_travel`).

## Health / ready

```bash
curl -s http://127.0.0.1:3000/health && curl -s http://127.0.0.1:3000/ready
curl -s http://127.0.0.1:3004/health && curl -s http://127.0.0.1:3004/ready
curl -s http://127.0.0.1:3005/health && curl -s http://127.0.0.1:3005/ready
```

## Frontend origins (env only)

| App | Variable | Local value |
|-----|----------|-------------|
| DSAAdmin | `NEXT_PUBLIC_API_ORIGIN` | `http://localhost:3004` |
| APLAdmin | `NEXT_PUBLIC_API_ORIGIN` | `http://localhost:3005` |
| B2C | `BACKEND_ORIGIN` | `http://127.0.0.1:3000` for local E2E |

Render production B2C remains `https://apltravelbackend.onrender.com`. Do not change Render secrets for local tests.

## Graceful shutdown

Each backend handles `SIGTERM`/`SIGINT`: HTTP close then Mongo disconnect.
