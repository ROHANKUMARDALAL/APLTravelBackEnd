# Standard response envelope

Every API response is a **single JSON object** with this shape:

### Success
```json
{
  "error": {
    "errorCode": 0,
    "ErrorMessage": "Success"
  },
  "success": true,
  "data": { },
  "meta": {
    "requestId": "..."
  }
}
```

### Failure
```json
{
  "error": {
    "errorCode": 1001,
    "ErrorMessage": "Invalid search request",
    "code": "VALIDATION_ERROR",
    "details": []
  },
  "success": false,
  "data": null,
  "meta": {
    "requestId": "..."
  }
}
```

| errorCode | Meaning |
|-----------|---------|
| 0 | Success |
| 1001 | Validation |
| 1002 | Not found |
| 1003 | Rate limited |
| 1004 | Internal |
| 1005 | Search failed |
| 1006 | Supplier error |
| 1007 | Database unavailable |
| 1008 | Payment failed |

Base URL: `http://localhost:3000`

There is **no login JWT** yet. Use the **`checkoutToken`** returned by checkout as the booking credential (MMT/Paytm-style review-session token).

Import: [`postman/APL-Travel-Backend.postman_collection.json`](./APL-Travel-Backend.postman_collection.json)

---

There is **no JWT**. After login, send the random **`loginToken`** as:

```http
Authorization: Bearer lgn_...
```

Signup stores `name`, `email`, `phoneNumber`, `password` (hashed), `profilePhoto` (image URL), and `currency` in the `users` collection. Password is never returned.

Booking, booking lists, booking details, cancellation, balance, and payment history all require that header. A user only sees their own records. Cancelling a confirmed booking refunds the amount onto `balance` and writes `CANCELLATION` plus `REFUND` actions.

### Signup
`POST http://localhost:3000/api/v1/auth/signup`

```json
{
  "name": "Rohan Dalal",
  "email": "rohan.traveller@example.com",
  "phoneNumber": "9876543210",
  "password": "Travel@123",
  "profilePhoto": "https://example.com/photos/rohan.jpg",
  "currency": "INR"
}
```

### Login
`POST http://localhost:3000/api/v1/auth/login`

```json
{
  "email": "rohan.traveller@example.com",
  "password": "Travel@123"
}
```

Copy `data.loginToken`.

## Flight flow (do this first)

### 0) Airport search (city → airports)
`POST http://localhost:3000/api/v1/flights/airports/search`

```json
{
  "query": "Delhi"
}
```

Or by city code:

```json
{
  "cityCode": "DEL"
}
```

Example airports returned for Delhi NCR:
- `DEL` — IGI (Indira Gandhi International)
- `HDO` — Hindon
- `DXN` — Noida International

Use the **`cityCode`** (e.g. `DEL`) in flight search — the backend expands it to **all** of those airports.

### 1) Search flights by city code
`POST http://localhost:3000/api/v1/flights/search`

```json
{
  "tripType": "ONEWAY",
  "originCityCode": "DEL",
  "destinationCityCode": "BOM",
  "departDate": "2026-10-15",
  "adults": 1,
  "children": 0,
  "infants": 0,
  "cabinClass": "ECONOMY",
  "currency": "INR"
}
```

(`origin` / `destination` still work as aliases for city codes.)

Response includes:
- `originCity.airports` — all airports searched
- `flights[]` — options from **DEL, HDO, DXN** (and arrival city airports), each with `departure.airportInfo`

Copy from response:
- `data.searchId`
- `data.flights[0].aplFlightId`
- `data.flights[0].flightFareData[0].aplFareId`

### 2) Details
`POST http://localhost:3000/api/v1/flights/details`

```json
{
  "searchId": "APL-SRCH-XXXXXXXX",
  "aplFlightId": "APL-FLT-XXXXXX",
  "aplFareId": "APL-OFFER-XXXXXX"
}
```

- `searchId` + `aplFlightId` are **required**
- `aplFareId` is **optional** on details (selects `selectedFlightFareData`; if omitted, lowest fare is selected)
- Response includes full `flightFareData[]` plus `selectedFlightFareData`

### 3) Revalidate (price check)
`POST http://localhost:3000/api/v1/flights/revalidate`

```json
{
  "searchId": "APL-SRCH-XXXXXXXX",
  "aplFlightId": "APL-FLT-XXXXXX",
  "aplFareId": "APL-OFFER-XXXXXX"
}
```

`aplFareId` is **required** here.

### 4) Checkout (passenger entry → token)
`POST http://localhost:3000/api/v1/flights/checkout`

```json
{
  "searchId": "APL-SRCH-XXXXXXXX",
  "aplFlightId": "APL-FLT-XXXXXX",
  "aplFareId": "APL-OFFER-XXXXXX",
  "contact": {
    "email": "rohan.traveller@example.com",
    "phone": "9876543210",
    "countryCode": "+91"
  },
  "travellers": [
    {
      "type": "ADULT",
      "title": "Mr",
      "firstName": "Rohan",
      "lastName": "Dalal",
      "dateOfBirth": "1995-05-12",
      "gender": "M",
      "nationality": "IN"
    }
  ],
  "addOns": { "seats": ["12A"], "baggage": [], "meals": ["VGML"] },
  "confirmPrice": { "amount": 6200, "currency": "INR" }
}
```

Copy `data.checkoutToken` (starts with `chk_...`).

### 5) Book (dummy payment)
`POST http://localhost:3000/api/v1/flights/book`

```json
{
  "checkoutToken": "chk_xxxxxxxx",
  "confirmPrice": { "amount": 6200, "currency": "INR" },
  "payment": {
    "method": "CARD",
    "cardNumber": "4111111111111111"
  }
}
```

Or UPI:

```json
{
  "checkoutToken": "chk_xxxxxxxx",
  "payment": {
    "method": "UPI",
    "upiId": "rohan@okaxis"
  }
}
```

**Test decline:** card ending in `0000` fails (like sandbox cards).

### 6) Get booking
`GET http://localhost:3000/api/v1/bookings/APL-BK-XXXXXXXX`

---

## Hotel flow

Base URL: `http://localhost:3000`

### 1) City search
`POST /api/v1/hotels/cities/search`

```json
{ "query": "Delhi" }
```

Use `cities[].cityCode` (example: `130443` for New Delhi). Hotel city codes are numeric, the same shape live suppliers return.

### 2) Hotel search for that city
`POST /api/v1/hotels/search`

```json
{
  "cityCode": "130443",
  "checkIn": "2026-10-20",
  "checkOut": "2026-10-22",
  "rooms": 1,
  "adults": 2,
  "children": 2,
  "childAges": ["5", "8"],
  "currency": "INR"
}
```

When `children` is greater than 0, `childAges` is required and must be the same length, each age a string. Use `[]` or omit it when there are no children.

Copy `searchId` and a hotel's `aplHotelId`. Each hotel includes `availableRooms[]` with `aplRoomId`.

### 3) Hotel details (list rooms)
`POST /api/v1/hotels/details`

```json
{
  "searchId": "APL-SRCH-XXXXXXXX",
  "aplHotelId": "APL-HOTEL-XXXXXX"
}
```

Optional `aplRoomId` marks `selectedRoom`.

### 4) Revalidate the selected room
`POST /api/v1/hotels/revalidate`

```json
{
  "searchId": "APL-SRCH-XXXXXXXX",
  "aplHotelId": "APL-HOTEL-XXXXXX",
  "aplRoomId": "APL-ROOM-XXXXXX"
}
```

### 5) Checkout
`POST http://localhost:3000/api/v1/hotels/checkout`

```json
{
  "searchId": "APL-SRCH-XXXXXXXX",
  "aplHotelId": "APL-HOTEL-XXXXXX",
  "aplRoomId": "APL-ROOM-XXXXXX",
  "addOns": { "extraServices": ["BREAKFAST"] },
  "confirmPrice": { "amount": 9450, "currency": "INR" },
  "contact": {
    "email": "rohan.traveller@example.com",
    "phone": "9876543210",
    "countryCode": "+91"
  },
  "guests": [
    { "type": "ADULT", "title": "Mr", "firstName": "Rohan", "lastName": "Dalal" },
    { "type": "ADULT", "title": "Ms", "firstName": "Priya", "lastName": "Sharma" }
  ]
}
```

### Book
`POST http://localhost:3000/api/v1/hotels/book`

```json
{
  "checkoutToken": "chk_xxxxxxxx",
  "confirmPrice": { "amount": 9450, "currency": "INR" },
  "payment": { "method": "UPI", "upiId": "rohan@okaxis" }
}
```

`confirmPrice.amount` on book must be the same number locked at checkout. A different amount is rejected as a price mismatch.

### Booking list and details

`GET http://localhost:3000/api/v1/hotels/bookings`

`POST http://localhost:3000/api/v1/hotels/bookings/details`

```json
{ "bookingId": "APL-BK-XXXXXXXX" }
```

Flight list and details use the same shape under `/api/v1/flights/bookings` and `/api/v1/flights/bookings/details`.

## Price confirmation

Pass `confirmPrice` on **checkout** and again on **book**. The server adds the base fare or room price to the selected add-ons and accepts the step only when that total matches exactly.

Flight add-ons come from details `addOns` (seat `12A` ₹450, meal `VGML` ₹350, baggage `BG15` ₹1200). Hotel extras come from each room's `extraServices` (`BREAKFAST` ₹800, `LATE_CHECKOUT` ₹1500, `AIRPORT_TRANSFER` ₹1800).

Example flight checkout (1 adult, seat 12A, veg meal):

```json
{
  "addOns": { "seats": ["12A"], "baggage": [], "meals": ["VGML"] },
  "confirmPrice": { "amount": 6200, "currency": "INR" }
}
```

`6200` here is only an illustration: use `selected fare × paying travellers + add-on prices`. Infants are not charged the fare. The book body repeats that same `confirmPrice`.

---

## Headers (optional)

| Header | Purpose |
|--------|---------|
| `Content-Type: application/json` | Required for POST |
| `x-request-id` | Your correlation id (optional) |
| `X-Simulate-Supplier-Failure: KAFILA` | Partial supplier failure on search |

No Bearer token required for this local dummy stage.
