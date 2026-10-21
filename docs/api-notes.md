# NSW Fuel API notes

Researched 2026-10-21. The primary source is the machine-readable Swagger 2.0
spec that the API.NSW product page embeds:

- Product page: https://api.nsw.gov.au/Product/Index/22
- Spec: https://apinsw.onegov.nsw.gov.au/api/swagger/spec/22 (`info.version` 2.0.05,
  host `api.onegov.nsw.gov.au`)
- Terms: https://api.nsw.gov.au/Home/Terms

Each fact below is tagged **[spec]** (quoted from the spec), **[page]**
(product or terms page), or **[inferred]** (from working open-source clients
or forum posts, not documented). Anything marked **verify** has to be checked
against a live response once we have credentials.

## Summary

| Question            | Answer                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Auth                | OAuth client credentials. `GET` token endpoint with `Basic base64(key:secret)`, ~12 h token                |
| Base URL            | `https://api.onegov.nsw.gov.au`                                                                            |
| Version             | **v2**, filtered to NSW in our normaliser                                                                  |
| Endpoints we use    | `GET /FuelCheckRefData/v2/fuel/lovs`, `POST .../v2/fuel/prices/nearby`, `POST .../v2/fuel/prices/location` |
| Free plan quota     | **2,500 calls / month** (~80 a day) **[page]**. Per-minute limits not published                            |
| Over-quota response | Not documented (no 429 in the spec)                                                                        |
| Attribution         | No wording required on API.NSW. We will credit "Source: NSW Government FuelCheck"                          |
| Historical prices   | **No API endpoint.** Monthly files on data.nsw.gov.au (CC BY-SA)                                           |

## Auth

**Token** **[spec]**

```http
GET https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials
Authorization: Basic base64("<API key>:<API secret>")
```

- The token endpoint is a `GET`, not the usual OAuth `POST`.
- Lifetime is "approximately 12 hours" **[page]**.
- `expires_in` is a **string** of seconds, e.g. `"43199"` **[inferred: forum sample]**.
- `issued_at` is epoch milliseconds from the issuer's clock. We never use it.
  Expiry is computed as our clock at receipt plus `expires_in`, so clock skew
  between Netlify and API.NSW cannot expire a token early or late.

Response, values replaced:

```json
{
  "access_token": "…",
  "expires_in": "43199",
  "token_type": "BearerToken",
  "issued_at": "1631666514337",
  "client_id": "…",
  "application_name": "…",
  "status": "approved",
  "api_product_list_json": ["Fuel Check Portal Api"],
  "organization_name": "onegov",
  "refresh_token_expires_in": "0",
  "refresh_count": "0",
  "scope": ""
}
```

- `token_type` is `"BearerToken"`, but the header to send is still `Authorization: Bearer <token>`.
- Bad credentials return 401 with `{"ErrorCode":"invalid_client","Error":"Client credentials are invalid"}`.

**Headers on every data call** **[spec]** (all marked required):

| Header             | Value                                                           |
| ------------------ | --------------------------------------------------------------- |
| `Authorization`    | `Bearer <access_token>`                                         |
| `apikey`           | The API key (the same key used in the Basic header)             |
| `transactionid`    | Unique per call. We send a UUID                                 |
| `requesttimestamp` | UTC, `dd/MM/yyyy hh:mm:ss AM/PM`, e.g. `21/10/2026 01:05:09 PM` |
| `Content-Type`     | `application/json; charset=utf-8` (required even on GETs)       |

Some clients send ISO 8601 for `requesttimestamp` and report it working **[inferred]**. The
spec's own error example ("String was not recognized as a valid DateTime")
shows the server parses date headers, so we send the documented format.

**Terms that matter for a proxy** **[page]**:

- "Your access to the service will be denied if you enter incorrect
  identification information on more than 3 consecutive occasions."
- Because of that rule, the function stops calling the token endpoint for five minutes after
  a credentials failure (see `upstream.ts`).

## Endpoints

### Reference data: `GET /FuelCheckRefData/v2/fuel/lovs`

- Extra required header: `if-modified-since` (same format as `requesttimestamp`) **[spec]**.
  We send `01/01/2010 12:00:00 AM` so the response always includes everything.
  An empty response is reportedly returned when nothing changed **[inferred]**.
- Optional query `states`, `|`-delimited (`NSW|TAS`). It defaults to NSW **[spec]**.
- The response "can be over 2 mb" **[spec]** because it carries every station.
  We parse only `fueltypes` and `brands` and serve those.

```json
{
  "brands": { "items": [{ "name": "BP", "state": "NSW" }] },
  "fueltypes": { "items": [{ "code": "E10", "name": "Ethanol 94", "state": "NSW" }] },
  "stations": {
    "items": [
      {
        "brandid": "…",
        "stationid": "…",
        "brand": "BP",
        "code": "382",
        "name": "BP Wyoming",
        "address": "481 Pacific Highway, Wyoming NSW 2250",
        "location": { "latitude": -33.408004, "longitude": 151.351119 },
        "state": "NSW"
      }
    ]
  },
  "trendperiods": { "items": [{ "period": "Day", "description": "Price trend today" }] },
  "sortfields": { "items": [{ "code": "Distance", "name": "Sort results by distance…" }] },
  "priceunits": "shape not documented",
  "lastmodifiedtimestamps": "shape not documented"
}
```

### Prices nearby: `POST /FuelPriceCheck/v2/fuel/prices/nearby`

"Returns current fuel prices for a single fuel type within a specified radius
from a reference point. **If no stations exist within the radius then fuel
prices for the closest 10 stations are returned.**" **[spec]**

Request. Every field is a string, including the numbers and the boolean **[spec]**:

```json
{
  "fueltype": "P95",
  "brand": [],
  "namedlocation": "",
  "latitude": "-33.43",
  "longitude": "151.3",
  "radius": "5",
  "sortby": "price",
  "sortascending": "true"
}
```

- Radius units are not documented. They are km in every client we found **[inferred, verify]**.
- `brand: []` and `namedlocation: ""` mean "no filter" **[inferred]**.

Response. `stations` and `prices` are separate arrays, joined on
`stations[].code` = `prices[].stationcode`:

```json
{
  "stations": [
    {
      "stationid": "1-GN9E-441",
      "brandid": "1-GFYV-0",
      "brand": "BP",
      "code": 382,
      "name": "BP Wyoming",
      "address": "481 Pacific Highway, Wyoming NSW 2250",
      "location": { "latitude": -33.408004, "longitude": 151.351119, "distance": 5.96 },
      "state": "NSW"
    }
  ],
  "prices": [
    {
      "stationcode": 382,
      "fueltype": "P95",
      "price": 186.9,
      "priceunit": "litre",
      "description": "",
      "lastupdated": "2019-09-29 22:48:51",
      "state": "NSW"
    }
  ]
}
```

### Prices by suburb or postcode: `POST /FuelPriceCheck/v2/fuel/prices/location`

All fields are required **[spec]**, including a `referencepoint`, even though a suburb search has
no meaningful origin. We send Sydney GPO and discard the resulting distances
**[verify that the reference point does not change which stations come back]**.

```json
{
  "fueltype": "P95",
  "brand": [],
  "namedlocation": "2065",
  "referencepoint": { "latitude": "-33.8679", "longitude": "151.2073" },
  "sortby": "price",
  "sortascending": "true"
}
```

The response reuses the v1 schema: string codes, no `state`, and a different date format:

```json
{
  "stations": [
    {
      "brand": "BP",
      "code": "301",
      "name": "BP Naremburn",
      "address": "169 Willoughby Road, Naremburn NSW 2065",
      "location": { "latitude": -33.820024, "longitude": 151.201159, "distance": 43.48 }
    }
  ],
  "prices": [
    {
      "stationcode": "301",
      "fueltype": "P95",
      "price": 186.9,
      "lastupdated": "26/09/2019 02:51:27"
    }
  ]
}
```

### Prices by station (for later): `GET /FuelPriceCheck/v2/fuel/prices/station/{stationCode}`

- Optional `state` query param, which defaults to NSW. It exists because "stationCode is not
  guaranteed to be unique across states" **[spec]**.
- Returns every fuel type for that station:

```json
{ "prices": [{ "fueltype": "U91", "price": 151.9, "lastupdated": "30/09/2019 00:01:55" }] }
```

### Also available, not used yet

- `GET /FuelPriceCheck/v2/fuel/prices` returns all current prices statewide. It is over 2 MB, and "there
  may be restrictions on how often this API request can be made" **[spec]**.
- `GET /FuelPriceCheck/v2/fuel/prices/new` returns prices changed since the last `/prices` or
  `/prices/new` call **by this API key, today** **[spec]**. The cursor is server-side
  state tied to the key. Two processes calling it would steal each other's
  changes, so only a single scheduled job could use it safely.

These two are the basis of the snapshot alternative in "Decisions to
revisit" below.

### Errors

Data endpoints document 400, 401 and 500 **[spec]**:

```json
{
  "errorDetails": {
    "code": "-2146233033",
    "message": "String was not recognized as a valid DateTime."
  }
}
```

- An invalid token returns `{"errorDetails":{"code":"TokenValidationError","message":"Access token is not valid."}}` **[inferred: forum]**.
- 429 is not documented. We map it to `upstream_rate_limited` in case it appears.

## Data quirks the normaliser handles

| Quirk                                                                               | Handling                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Station code is an integer (nearby) or a string (everything else)                   | Coerced to string                                                               |
| `lastupdated` is `yyyy-MM-dd HH:mm:ss` (nearby) or `dd/MM/yyyy HH:mm:ss` (the rest) | Both parsed                                                                     |
| `lastupdated` timezone is not documented                                            | Assumed Sydney local time, output as ISO with offset **[verify]**               |
| v2 includes Tasmania                                                                | Rows with a `state` other than NSW dropped                                      |
| Nearby falls back to the closest 10 stations if none are in the radius              | Passed through with `distanceKm`. The client decides how to present far results |
| `sortby` example is `"price"` in one place and `"Price"` in another                 | We sort ourselves                                                               |
| Price is cents per litre (`186.9`)                                                  | `priceCents`                                                                    |

## v1 or v2

**Decision: v2, filtered to NSW.**

- v1 is NSW only. v2 is NSW plus Tasmania, with a `state` field on rows **[spec]**.
- Nothing marks v1 as deprecated, and the product page has had no release notes since 2016.
- v2 is the version the spec is maintained around, and it adds `priceunit`, a per-station
  `state` parameter and the `states` filter. Filtering to NSW costs one comparison in the normaliser.
- If v1 were withdrawn, we would have to migrate. v2 carries no such risk.
- The location endpoint already returns the v1 shape under v2, so the normaliser handles both shapes anyway.

## Rate limits and caching

- **Free plan: 2,500 calls a month [page].** That is ~80 a day across every visitor.
- Whether token calls count towards the quota is not stated. With a 12-hour token, at most a
  few per instance per day.
- The public sandbox key on the product page is limited to 5 calls a minute [page]. Per-minute
  limits for a real key are not published.
- Retailers report price changes to FuelCheck as they make them. No publish cadence is
  documented, and a 2026 ministerial release describes reporting "in real time".

How the function stays inside the quota:

- Input is validated before any upstream call, so a bad request costs nothing.
- Nearby coordinates are rounded to 2 decimals (~1 km). Neighbours produce the same URL and share
  a CDN entry. The frontend must round the same way, or every URL is unique and misses.
- `Netlify-CDN-Cache-Control: public, durable, …`: `durable` stores the response in Netlify's
  shared cache, so one miss fills every edge node.
  - Prices: `s-maxage=300, stale-while-revalidate=300`.
  - Reference data: `s-maxage=86400`.
- Browser `Cache-Control` is short (60 s for prices, 1 h for reference data), because a browser
  cache cannot be purged.

## Terms of use for a public portfolio site

- The API.NSW terms are generic. Keep the key secret. Access is denied after 3 consecutive
  failed identifications. Information use "may be governed by terms and conditions stipulated by
  the authority administering the licence".
- No attribution wording, licence, caching or redistribution rule, or logo rule is published for
  the Fuel API itself.
- The Premium plan mentions a "custom service licensing agreement". That suggests commercial or
  high-volume use is negotiated case by case.
- The **historical** dataset on data.nsw.gov.au is **CC BY-SA**. That licence covers the dataset,
  not the live API.

Plan:

- Show "Source: NSW Government FuelCheck" in the footer, with a link.
- Optionally email fuelchecknews@customerservice.nsw.gov.au to confirm a non-commercial public
  demo is fine. The address is listed on the nsw.gov.au FuelCheck page.

## Historical prices (affects Phase 4)

**No API endpoint returns history.**

- `/lovs` lists `trendperiods` (Day/Week/Month/Year), but the published API has no trends endpoint **[spec]**.
- The FuelCheck web app calls an unauthenticated `/FuelCheckApp/v1/fuel/prices/trends/`
  **[inferred]**. It is undocumented and outside the published API, so we will not use it.

Options for the Phase 4 chart:

1. **data.nsw.gov.au "FuelCheck" dataset**
   (https://data.nsw.gov.au/data/dataset/fuel-check).
   - Monthly price-history files from 2016 to September 2026, updated monthly, licensed CC BY-SA.
   - Good for monthly trends; it can't show "today".
2. **Record our own history.** A scheduled function snapshots prices into Netlify Blobs.
   - It costs quota and only starts from the day it is switched on.
3. Drop the chart, or reduce it to "price changed X hours ago" from `lastupdated`.

## TypeScript types

Upstream shapes, as parsed (`netlify/functions/api/schemas.ts`, written as
Zod schemas; these are the inferred types):

```ts
interface UpstreamStation {
  code: string; // number | string upstream, coerced
  name: string;
  brand: string;
  address: string;
  location: { latitude: number; longitude: number; distance?: number };
  state?: string; // v2 only
}

interface UpstreamPrice {
  stationcode: string; // number | string upstream, coerced
  fueltype: string;
  price: number; // cents per litre
  lastupdated: string; // "yyyy-MM-dd HH:mm:ss" or "dd/MM/yyyy HH:mm:ss"
  state?: string;
}

interface UpstreamPricesResponse {
  stations: UpstreamStation[];
  prices: UpstreamPrice[];
}

interface UpstreamReferenceResponse {
  brands: { items: { name: string; state?: string }[] };
  fueltypes: { items: { code: string; name: string; state?: string }[] };
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // "43199" upstream, coerced
}
```

Our contract with the browser (`shared/api.ts`):

```ts
interface StationPrice {
  stationCode: string;
  name: string;
  brand: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceKm: number | null; // null for suburb/postcode searches
  priceCents: number;
  priceUpdatedAt: string; // ISO 8601 with offset
}

interface PricesResponse {
  fuelType: string;
  stations: StationPrice[];
}

interface ReferenceResponse {
  fuelTypes: { code: string; name: string }[];
  brands: string[];
}

interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
```

## Our routes

| Route                                   | Upstream           | Errors                                         |
| --------------------------------------- | ------------------ | ---------------------------------------------- |
| `GET /api/reference`                    | `/lovs`            | 5xx only                                       |
| `GET /api/nearby?lat&lng&fuel[&radius]` | `/prices/nearby`   | 400 outside NSW, bad number, unknown fuel      |
| `GET /api/location?query&fuel`          | `/prices/location` | 400 not a suburb or a postcode starting 1 or 2 |

Status codes:

| Status | Meaning                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------- |
| 400    | Bad input (`bad_request`)                                                                                 |
| 404    | Unknown path                                                                                              |
| 405    | Not GET (with an `Allow` header)                                                                          |
| 500    | Credentials missing (`not_configured`), or an unexpected error (`internal_error`)                         |
| 502    | Upstream rejected our credentials (`upstream_auth`), or sent something we cannot parse (`upstream_error`) |
| 503    | Upstream down or rate limiting (with `Retry-After`)                                                       |
| 504    | Upstream timeout (3 s per request)                                                                        |

Errors are always `Cache-Control: no-store`.

## Still to verify with live credentials

Record a real response for each endpoint into `netlify/functions/api/__fixtures__/` and check:

1. The `lastupdated` timezone. If it is UTC, change `parseUpstreamTimestamp`.
2. Radius and distance units are km.
3. Whether the location endpoint's `referencepoint` changes which stations come back.
4. The fuel type codes in `shared/fuelTypes.ts` against `/api/reference`.
5. The shapes of `priceunits` and `lastmodifiedtimestamps` (unused, for completeness).
6. Whether the API.NSW dashboard shows token calls counting towards the quota.

## Getting credentials

1. Sign up at https://api.nsw.gov.au (top right, "Sign up"). Then sign in.
2. Go to **My Apps** and create an app (any name, e.g. "NSW Fuel Finder").
3. Open the **Fuel API** product (https://api.nsw.gov.au/Product/Index/22) and
   subscribe your app to it on the free plan.
4. Your app now shows an **API Key** and an **API Secret**. Copy them into `.env`:

   ```bash
   cp .env.example .env
   # FUEL_API_KEY=<API Key>
   # FUEL_API_SECRET=<API Secret>
   ```

5. Do not use the sandbox key and secret printed on the product page. They are shared, and
   limited to 5 calls a minute.
6. When we deploy, set the same two variables in the Netlify UI, scoped to Functions.

## Local development

```bash
npm install -g netlify-cli
pnpm dev:netlify
```

This serves Vite and the function behind one origin at http://localhost:8888, with `/api/*`
rewritten as in production. `pnpm dev` alone runs Vite without the API.

- **Windows needs Developer Mode** (Settings > System > For developers).
  - Netlify bundles v2 functions with NFT, which recreates pnpm's symlinked `node_modules` next to
    the function. Windows refuses symlinks without Developer Mode, and the CLI crashes with
    `EPERM: operation not permitted, symlink …zod…`.
  - The alternative, `nodeLinker: hoisted` in `pnpm-workspace.yaml`, also works. It was tested, but
    it loosens pnpm's dependency isolation for the whole repo.
- `pnpm dlx netlify-cli` does not work: the CLI's postinstall cannot find `chalk` under pnpm's
  layout. Install the CLI with npm.
