# APL Travel Backend

Provider-independent OTA backend for APL Travel.

**Stack:** Node.js · JavaScript (`.js`) · Express · MongoDB (Mongoose)

This repository is separate from the static/mock frontend in `travelweb/b2c-travel`. Do not connect them yet.

## Architecture (hotel search vertical slice)

```text
POST /api/v1/hotels/search
  → validate
  → call mock supplier adapters (in parallel)
  → preserve raw payloads (Layer A)
  → normalize
  → entity resolution / dedupe (multi-signal, not name-only)
  → consolidate offers under APL hotel IDs (Layer B + C)
  → apply APL pricing layer (markup configurable; default 0)
  → return canonical APL response
```

## Quick start

### 1. Environment

```bash
cp .env.example .env
```

### 2. MongoDB

**Option A — local Homebrew**

```bash
brew services start mongodb/brew/mongodb-community@7.0
# or:
brew services start mongodb-community@7.0
```

**Option B — Docker Compose**

```bash
docker compose up -d
```

Default `MONGODB_URI`:

```text
mongodb://127.0.0.1:27017/apl_travel
```

### 3. Install & run

```bash
npm install
npm run start:dev
```

Server: `http://localhost:3000`

## Implemented endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Includes MongoDB connectivity |
| GET | `/api/v1/suppliers` | Hotel + flight mock suppliers |
| POST | `/api/v1/flights/search` | Aggregate + dedupe |
| POST | `/api/v1/flights/details` | Offer details |
| POST | `/api/v1/flights/revalidate` | Price check |
| POST | `/api/v1/flights/checkout` | `confirmPrice` = fare × paying travellers + add-ons |
| POST | `/api/v1/auth/signup` | Creates a user |
| POST | `/api/v1/auth/login` | Returns random `loginToken` |
| GET | `/api/v1/auth/me` | Profile. Header `Authorization: Bearer <loginToken>` |
| GET | `/api/v1/account/balance` | Wallet balance |
| GET | `/api/v1/account/actions` | Payments, refunds, cancellations |
| GET | `/api/v1/account/cancellations` | Cancelled bookings |
| POST | `/api/v1/flights/book` | Requires login token |
| GET | `/api/v1/flights/bookings` | This user's flights |
| POST | `/api/v1/flights/bookings/details` | Body `{ "bookingId" }` |
| POST | `/api/v1/flights/bookings/cancel` | Body `{ "bookingId" }` |
| POST | `/api/v1/hotels/cities/search` | Numeric city codes |
| POST | `/api/v1/hotels/search` | `cityCode` + `childAges` when children > 0 |
| POST | `/api/v1/hotels/details` | Rooms + extra services |
| POST | `/api/v1/hotels/revalidate` | Selected `aplRoomId` |
| POST | `/api/v1/hotels/checkout` | `confirmPrice` must match room + extras |
| POST | `/api/v1/hotels/book` | Requires login token |
| GET | `/api/v1/hotels/bookings` | This user's hotels |
| POST | `/api/v1/hotels/bookings/details` | Body `{ "bookingId" }` |
| POST | `/api/v1/hotels/bookings/cancel` | Body `{ "bookingId" }` |
| GET | `/api/v1/bookings/:aplBookingRef` | This user's booking |

Dummy booking guide: [`postman/BOOKING_GUIDE.md`](postman/BOOKING_GUIDE.md)

### Partial failure testing

```http
X-Simulate-Supplier-Failure: KAFILA
```

Or set:

```env
MOCK_SUPPLIER_FAILURES=KAFILA
```

## Postman

Import [`postman/APL-Travel-Backend.postman_collection.json`](postman/APL-Travel-Backend.postman_collection.json).

## Sample request

```bash
curl -s http://localhost:3000/api/v1/hotels/search \
  -H 'Content-Type: application/json' \
  -d '{
    "cityCode": "130443",
    "checkIn": "2026-10-10",
    "checkOut": "2026-10-12",
    "rooms": 1,
    "adults": 2,
    "currency": "INR"
  }'
```

Expect Novotel Aerocity (three supplier variants) as **one** `aplHotelId` with several `availableRooms` (`aplRoomId`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Watch mode (`node --watch`) |
| `npm start` | Production start |
| `npm test` | Entity-resolution tests |
| `npm run lint:check` | ESLint |

## Project layout

```text
src/
  app.js
  server.js
  common/                 # shared across services
    config/
    database/             # connection + shared models (Supplier, Search, Booking, …)
    errors/
    middleware/
    response/
    utils/
  health/                 # platform health
    routes/
  suppliers/              # GET /api/v1/suppliers (aggregates registered adapters)
    routes/
  hotel/                  # hotel vertical slice (self-contained)
    routes/
    services/
    validators/
    models/
    suppliers/            # TBO / TripJack / Kafila mock adapters + registry
    data/                 # mock hotel inventory
    utils/                # normalize, resolve, price, consolidate
```

Flight, bus, holiday, car, and insurance modules are not present yet; add them in the same service-wise pattern when those vertical slices are built.

## What is next

1. Hotel details / availability / revalidate
2. Booking orchestration (separate booking / payment / supplier booking states)
3. Flight search vertical slice
4. Real supplier adapters behind the same interfaces
5. Frontend wiring to deployed `/api/v1` base URL
