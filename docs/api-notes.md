# NSW Fuel API notes

Researched 2026-10-21 from the Swagger 2.0 spec that the API.NSW product page
embeds, then verified against live responses the same day.

- Product page: https://api.nsw.gov.au/Product/Index/22
- Spec: https://apinsw.onegov.nsw.gov.au/api/swagger/spec/22 (`info.version` 2.0.05)
- Terms: https://api.nsw.gov.au/Home/Terms

Tags: **[live]** seen in a real response; **[spec]** quoted from the spec;
**[page]** product or terms page; **[inferred]** from open-source clients or
forum posts.

## Summary

| Question          | Answer                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Auth              | OAuth client credentials: `GET` token endpoint, `Basic base64(key:secret)`, 12 h token **[live]**       |
| Endpoint we use   | **Only** `GET /FuelPriceCheck/v2/fuel/prices` (statewide), from a scheduled job                         |
| Response          | 1.75 MB, 3,286 stations (2,397 sell fuel), 10,577 price rows, 0.7–1.4 s **[live]**                      |
| Timestamps        | `lastupdated` is **UTC** **[live]**, not Sydney time                                                    |
| Free plan quota   | 2,500 calls / month **[page]**. No rate-limit headers; an immediate repeat was not throttled **[live]** |
| Attribution       | No wording required. We credit "Source: NSW Government FuelCheck"                                       |
| Historical prices | No API endpoint. We record our own from launch; monthly files on data.nsw.gov.au                        |

## Live verification (2026-10-21)

Seven calls in total: 4 to verify, 3 to test the scheduled job locally.
Logged in the session scratchpad, not in the repo:

| Time (UTC) | Call                                                  | Status | Time    | Size    |
| ---------- | ----------------------------------------------------- | ------ | ------- | ------- |
| 03:21:06   | token                                                 | 200    | 129 ms  | 551 B   |
| 03:21:27   | `/prices`                                             | 200    | 669 ms  | 1.75 MB |
| 03:21:28   | `/prices` (immediate repeat)                          | 200    | 1126 ms | 1.75 MB |
| 03:21:29   | `/lovs`                                               | 200    | 1440 ms | 715 kB  |
| 03:38:24   | token (local `snapshot` run, empty local Blobs)       | 200    |         |         |
| 03:38:24   | `/prices` (same run; whole run ~0.9 s)                | 200    |         |         |
| 03:39:00   | `/prices` (second local run; token reused from Blobs) | 200    | ~1 s    |         |

The six questions left open last round:

1. **`lastupdated` timezone: UTC, not Sydney.** Fetched at 03:21 UTC (14:21
   in Sydney), the newest `lastupdated` was `21/10/2026 03:17:28`, and the
   day's 415 updates all fell between 00:00 and 03:17. That is Sydney's late
   morning to early afternoon. Read as Sydney time, they would have been 11 hours in
   the future. The `/lovs` `Last-Modified` header (`03:12:55 GMT`) also equals a
   `lastupdated` value exactly. **Fixed:** `parseUpstreamTimestamp` reads UTC.
2. **Radius and distance units:** not checked. The nearby endpoint is no
   longer used; we compute distances ourselves.
3. **Does `referencepoint` change location results?** Not checked, for the
   same reason: the location endpoint is no longer used.
4. **Fuel types:** `/lovs` lists 16. Ten have price rows. The other six are:
   - the combined search codes `E10-U91`, `P95-P98` and `DL-PDL`;
   - LNG, H2 and CNG, which have no prices.

   EV has 902 rows, of which 900 are 0 and the other two date from 2020–21, priced
   per kWh. **Changed:** `shared/fuelTypes.ts` now holds the 9 fuels with real
   prices, using FuelCheck's names (E85 is "Ethanol 105").

5. **`priceunits` and `lastmodifiedtimestamps`:** absent from the live `/lovs`,
   although the spec marks both required. Unused.
6. **Do token calls count towards the quota?** Can't be seen from the API;
   it needs the API.NSW dashboard. With the token now kept in Blobs, it matters
   little: about 2 token calls a day.

## Auth [live]

```http
GET https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials
Authorization: Basic base64("<API key>:<API secret>")
```

Response, values replaced. The keys and types are exactly as live:

```json
{
  "refresh_token_expires_in": "0",
  "api_product_list": "[Fuel Check Portal Api]",
  "api_product_list_json": ["Fuel Check Portal Api"],
  "organization_name": "onegov",
  "developer.email": "…",
  "token_type": "BearerToken",
  "issued_at": "1631666514337",
  "client_id": "…",
  "access_token": "…",
  "application_name": "…",
  "scope": "",
  "expires_in": "43199",
  "refresh_count": "0",
  "status": "approved"
}
```

- `expires_in` is a string of seconds (12 hours). Expiry is computed as our clock
  plus `expires_in`; the issuer's `issued_at` is never compared with our clock.
- A bad key or secret returns 401 `{"ErrorCode":"invalid_client",…}` **[spec]**.
- **"Access to the service will be denied if you enter incorrect identification
  information on more than 3 consecutive occasions"** **[page]**. See the
  lockout guard below.

Headers on the data call **[spec]**, all accepted live:

| Header             | Value                             |
| ------------------ | --------------------------------- |
| `Authorization`    | `Bearer <access_token>`           |
| `apikey`           | The API key                       |
| `transactionid`    | A UUID per call                   |
| `requesttimestamp` | UTC, `dd/MM/yyyy hh:mm:ss AM/PM`  |
| `Content-Type`     | `application/json; charset=utf-8` |

## `GET /FuelPriceCheck/v2/fuel/prices` [live]

"Returns all current fuel prices for all service stations" **[spec]**. The
`states` parameter defaults to NSW; we send `states=NSW` explicitly.
Every row in the live response has `state: "NSW"`.

```json
{
  "stations": [
    {
      "brandid": "",
      "stationid": "",
      "brand": "United",
      "code": "972",
      "name": "United Petroleum Umina",
      "address": "307-313 Ocean Beach Road, UMINA BEACH NSW 2257",
      "location": { "latitude": -33.511231, "longitude": 151.318092 },
      "state": "NSW"
    }
  ],
  "prices": [
    {
      "stationcode": 1,
      "state": "NSW",
      "fueltype": "DL",
      "price": 286.9,
      "lastupdated": "18/10/2026 01:30:32"
    }
  ]
}
```

What the live data shows:

- **It includes each station's name, brand, address and coordinates.** This is
  what makes the snapshot possible: one call holds everything a search needs.
- `stations[].code` is a **string**, while `prices[].stationcode` in the same
  response is a **number**.
- No `priceunit` or `description` (the spec's nearby example has them).
- One price per station per fuel. No orphan prices, and every station has at
  least one price row.
- **889 of the 3,286 "stations" are EV chargers** (motels, NRMA fast chargers)
  whose only rows are EV. They are dropped, leaving **2,397 fuel stations**.
- **69 stations are in the ACT** (63 of them sell fuel), although their `state`
  is "NSW". The address is what tells them apart.
- **Price age** (non-EV):

  | Age             | Prices |
  | --------------- | ------ |
  | Less than a day | 1,856  |
  | 1–7 days        | 5,276  |
  | 7–30 days       | 2,209  |
  | 30–90 days      | 276    |
  | 90–365 days     | 52     |
  | Over a year     | 6      |

  The oldest is from 2018. Stations report a price when it changes, so an old
  timestamp can mean "unchanged" as easily as "abandoned". We pass
  `priceUpdatedAt` through, and the UI shows age.

- **Price ranges** (cents/L, min / median / max):

  | Fuel | Min   | Median | Max   |
  | ---- | ----- | ------ | ----- |
  | U91  | 212.3 | 240.9  | 369   |
  | E10  | 223.5 | 236.9  | 267.9 |
  | P95  | 231.8 | 256.9  | 298.9 |
  | P98  | 244.7 | 265.9  | 389   |
  | DL   | 257.5 | 282.7  | 381   |
  | PDL  | 257.3 | 283.9  | 304.9 |
  | LPG  | 97.9  | 119.5  | 200   |
  | E85  | 229.5 | 259.9  | 475   |
  | B20  | 298.9 | 298.9  | 298.9 |

  B20 is sold at one station.

- **Frequency restriction:** an immediate second call returned 200 with
  identical data, and no rate-limit or quota headers were present. The
  response passes through Cloudflare (`cf-cache-status: DYNAMIC`, so it is not
  cached). Whatever restriction the spec mentions was not visible at 2 calls
  a second.

### Addresses, and why suburb search needs care

Every address ends in a state and a four-digit postcode, after tolerating:

- `NEW SOUTH WALES` in place of `NSW` (1 address);
- a trailing `, AU` (1);
- `ACT` (69).

The suburb is what follows the last comma, except in 22 fuel-station addresses
that have no comma before it. Two examples: `94 Sturt Hwy BALRANALD NSW 2715` and
`Wagga Wagga NSW 2650`. For those, the end of the address is matched against
suburbs seen in other addresses.

Edge cases, all handled in `netlify/lib/snapshot/address.ts` and
`netlify/functions/api/places.ts`:

| Case                        | Example                                                                                          | Handling                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Mixed case                  | `UMINA BEACH` vs `Umina Beach`                                                                   | Compared case-insensitively; all-caps shown title-cased                    |
| "Mt" vs "Mount"             | Data says `Mount Druitt`; people type `Mt Druitt`                                                | `placeKey` treats them as the same                                         |
| Same name, different places | Griffith NSW 2680 / Griffith ACT 2603 (303 km apart); Weston NSW 2326 / Weston ACT 2611 (355 km) | 409 `ambiguous_location` listing both; `query=Griffith ACT 2603` picks one |
| Same name, one outlier      | Emmdale Roadhouse is 149 km from Cobar, but its address is `COBAR NSW 2835`                      | Same label, so the larger group is the place                               |
| Spread-out places           | White Cliffs' stations are 19 km apart                                                           | Grouped with a 40 km single-linkage threshold                              |
| Wrong postcodes             | `Cowra NSW 2646` (2646 is Corowa's); 32 postcodes have stations more than 40 km apart            | A postcode is located by its largest cluster of stations                   |
| Suburb with no station      | `Bondi Beach`, any purely residential suburb                                                     | Resolved from the ABS gazetteer (round 3); see "Place lookup"              |
| Partial name                | `Wagga` for Wagga Wagga                                                                          | Resolved as a unique prefix; the UI also suggests as you type              |

## Not used

- **`/lovs` (reference data).** 715 kB. Everything we need from it is either static
  (9 fuel names, now in `shared/fuelTypes.ts`) or already in `/prices` (brand
  names, every priced station). Its station list adds only 50 stations, none
  of them priced.
- **`/prices/nearby` and `/prices/location`.** Each search would cost a call;
  the snapshot answers searches with none. Shapes and quirks are in the spec
  and in git history (`docs/api-notes.md` as of commit `de59a16`).
- **`/prices/new`.** Changes since the last call by this key, today.
  - It would save bandwidth but not calls, and it adds server-side cursor state.
  - That cursor is tied to the API key: a manual run would steal changes from
    the scheduled one.
- **`/prices/station/{code}`.** All fuels at one station. Not needed: the
  snapshot already has every fuel per station.

## Architecture: scheduled snapshot

```
every 30 min (cron, UTC)                         every request
netlify/functions/snapshot  ──writes──▶  Blobs  ◀──reads──  netlify/functions/api
  token (from Blobs, ~2 calls/day)              (30 s in-memory cache, strong fetchedAt check)
  GET /prices (1 call)                          /api/nearby, /api/location
  build snapshot + today's history              zero upstream calls
```

### Call budget

The budget is 2,500 calls per month. Planning for a 31-day month with 20%
headroom leaves 2,000 for the schedule.

| Interval   | Price calls/month | Token calls/month* | Total      | Fits in 2,000?           |
| ---------- | ----------------- | ------------------ | ---------- | ------------------------ |
| 15 min     | 2,976             | 62–93              | ~3,050     | no                       |
| 20 min     | 2,232             | 62–93              | ~2,310     | no                       |
| **30 min** | **1,488**         | **62–93**          | **~1,580** | **yes** (920 spare, 37%) |
| 60 min     | 744               | 62–93              | ~830       | yes                      |

\* Tokens last 12 h and are renewed 10 minutes early, which is 2 a day. The range
allows for a third if a renewal falls badly. The 920 spare calls cover
development, manual runs, a retry after an expired token (2 calls), and
redeploys.

### Blobs layout

The store is `fuel-finder`. It is site-wide, not deploy-scoped, so the snapshot and history
outlive deploys.

| Key                     | Contents                                                                               | Size                     |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------ |
| `snapshot/v1/latest`    | `{ version, fetchedAt, stations: [...] }`, with metadata `{ fetchedAt, stationCount }` | 875 kB (189 kB gzipped)  |
| `history/v1/YYYY-MM-DD` | The Sydney day's `[min, max, last]` per station per fuel                               | 262 kB/day (~95 MB/year) |
| `auth/token`            | `{ token, expiresAt }`                                                                 | tiny                     |
| `auth/failure`          | `{ credentials (hash), failures, lastFailedAt }`                                       | tiny                     |
| `meta/last-run`         | The last run's summary: ok/error, calls made, counts                                   | tiny                     |

A snapshot station:

```json
{
  "code": "2263",
  "name": "Ampol Foodary Wyoming",
  "brand": "Ampol",
  "address": "465 Pacific Hwy, WYOMING NSW 2250",
  "suburb": "Wyoming",
  "postcode": "2250",
  "state": "NSW",
  "lat": -33.4,
  "lng": 151.35,
  "prices": { "U91": [237.9, "2026-10-20T20:12:28Z"], "E10": [233.9, "2026-10-20T20:12:28Z"] }
}
```

A history day:

```json
{ "version": 1, "day": "2026-10-21", "fuels": { "U91": { "2263": [235.9, 237.9, 237.9] } } }
```

### Failure behaviour

| What fails                                                                    | What happens                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/prices` errors or times out                                                 | The run is logged in `meta/last-run`. The previous snapshot stays                                                                                                                                                                            |
| `/prices` returns under half the previous station count                       | Treated as partial and not written                                                                                                                                                                                                           |
| `/prices` returns a `null` body (seen once, 2026-10-23 16:00 UTC, after 10 s) | Logged as `bad_response`. The function returns 502, Netlify invoked it again 4 s later, and that run succeeded, costing 1 extra call. The lockout guard lives in Blobs, so a retry after a token rejection still never makes a third attempt |
| Token rejected once                                                           | No token call for an hour                                                                                                                                                                                                                    |
| Token rejected twice                                                          | **Never again with those credentials.** We never make the third attempt that would lock the account. Reset by changing either credential or deleting `auth/failure`                                                                          |
| Data call says 401                                                            | Token dropped, one retry with a fresh token                                                                                                                                                                                                  |
| No snapshot yet                                                               | `/api/*` returns 503 `snapshot_unavailable` with `Retry-After: 60`                                                                                                                                                                           |
| Snapshot older than 90 min (3 missed runs)                                    | Served with `stale: true`                                                                                                                                                                                                                    |
| Blobs unreadable                                                              | A warm instance keeps serving its copy; a cold one returns 503                                                                                                                                                                               |
| A newer snapshot is written but an older one is served                        | `/api/status` returns 503. Since round 3b the API checks the snapshot with strongly consistent reads every 30 s, bypassing the edge cache (decisions.md, "Snapshot stall")                                                                   |

## Our routes

| Route                                   | Returns                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/nearby?lat&lng&fuel[&radius]` | `PricesResponse`. lat/lng rounded to 2 dp; radius 1–25 km, default 5                                         |
| `GET /api/location?query&fuel[&radius]` | `PricesResponse` from the place's centre. `query` is a postcode, a suburb, or a suggestion label (see below) |
| `GET /api/places?query`                 | `PlaceSuggestionsResponse`: up to 8 place labels for a partly typed name or postcode                         |
| `GET /api/status`                       | `StatusResponse`: 200 if the pipeline is healthy, 503 with `problems` if not. Never cached                   |

`shared/api.ts`:

```ts
interface PricesResponse {
  fuelType: string;
  fetchedAt: string; // snapshot time, ISO UTC: "prices as of 2:30 pm"
  stale: boolean;
  origin: { latitude: number; longitude: number; label: string | null };
  stations: StationPrice[]; // cheapest first, then nearest, then name
}

interface StationPrice {
  stationCode: string;
  name: string;
  brand: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceKm: number; // from origin
  priceCents: number;
  priceUpdatedAt: string; // ISO UTC
}

interface PlaceSuggestionsResponse {
  query: string; // the query these answer, to spot a late response
  suggestions: string[]; // e.g. "Kingswood (Penrith) NSW 2747"
}
```

| Status | Code                   | When                                                             |
| ------ | ---------------------- | ---------------------------------------------------------------- |
| 400    | `bad_request`          | Outside NSW, a bad number, an unknown fuel, or a malformed query |
| 404    | `location_not_found`   | Not a NSW or ACT place or postcode                               |
| 404    | `not_found`            | Unknown path                                                     |
| 405    | `method_not_allowed`   | Anything but GET                                                 |
| 409    | `ambiguous_location`   | The name means more than one place. `candidates` lists them      |
| 503    | `snapshot_unavailable` | No snapshot yet, or Blobs is unreadable on a cold instance       |
| 500    | `internal_error`       | A bug                                                            |

`/api/places` never errors on odd input; it returns no suggestions.

Caching:

- Prices: `Cache-Control: public, max-age=60` for the browser, and
  `Netlify-CDN-Cache-Control: public, durable, s-maxage=60, stale-while-revalidate=60`
  for the edge.
- Suggestions: an hour in the browser, a day at the edge. They only change
  with a deploy, and a deploy purges the CDN.
- Errors are `no-store`.

### Place lookup (round 3)

Station addresses only know the 1,101 suburbs with a fuel station, so
`/api/location` now resolves places from a bundled ABS gazetteer
(`netlify/lib/places/gazetteer.json`, built by `scripts/build-gazetteer.js`):

- **Source:** ABS ASGS Edition 3 (2021), Suburbs and Localities and Postal
  Areas, from the ABS ArcGIS service (`geo.abs.gov.au`), CC BY 4.0.
- **Contents:** 4,678 NSW and ACT suburbs and localities with a centroid, and 637 postcodes
  (Norfolk Island's 2899 excluded).
- **Postcodes for suburbs:** each suburb's centroid is tested against the
  postal-area polygons, with a 3 km nearest-boundary fallback for coastal
  centroids that land offshore. The result agrees with the station's own
  address for 98.5% of stations (3,169 of 3,216). Eight border localities with
  VIC or QLD postcodes (Barooga, Texas, ...) have none.
- **Labels are unique**, using the ABS qualifier for repeated names:
  `Kingswood (Penrith) NSW 2747`. A label sent back as `query` resolves to
  exactly that place.
- **Size:** 293 kB (88 kB gzipped), loaded once per function instance.

Resolution order:

1. An exact label is that place.
2. A postcode is its station cluster, else the postal area's centre.
3. A name, narrowed by any qualifier, state or postcode given. If several places match, the
   answer is 409 with the choices.
4. A name nothing matches exactly, but which starts exactly one place's name ("Wagga"), resolves to that place.
   Several matches are a 409.
5. Names only station addresses know ("Dubbo North") fall back to them.

A suburb's stations are those whose address names it within 40 km of its
centre, plus any within the radius.

## Terms of use

Unchanged from the first round:

- Keep the key secret.
- 3 failed logins in a row and access is denied.
- No attribution, caching or redistribution rule is published for the Fuel API.
- The historical dataset on data.nsw.gov.au is CC BY-SA.

We show "Source: NSW Government FuelCheck". Serving a cached snapshot is the
same caching the per-request design did, just longer. If in doubt, email
fuelchecknews@customerservice.nsw.gov.au.

## Historical prices

There is no API endpoint for history. `/lovs` lists `trendperiods`, but the
published API has no trends endpoint. The scheduled job now records
`history/v1/YYYY-MM-DD` from launch. Before launch, the monthly files on
data.nsw.gov.au (2016 – September 2026) are the only source.

## Getting credentials

1. Sign up at https://api.nsw.gov.au, then create an app under **My Apps**.
2. Subscribe the app to the **Fuel API** (product 22) on the free plan.
3. Copy the app's **API Key** into `FUEL_API_KEY` and its **API Secret** into
   `FUEL_API_SECRET`, in `.env` (from `.env.example`).

## Local development

```bash
pnpm dev:netlify
```

This serves Vite and both functions behind http://localhost:8888, with
`/api/*` rewritten as in production and a local Blobs store in
`.netlify/blobs-serve` (gitignored).

Scheduled functions do not run on a schedule under `netlify dev`. Seed the
local snapshot by invoking the job by hand, in a second terminal while
`netlify dev` is running:

```bash
netlify functions:invoke snapshot --port 8888 --no-identity
```

- The first run on an empty local store costs 2 calls (token + prices).
  Later runs within 12 hours cost 1.
- The result is logged by `netlify dev` as `snapshot ok {…}`, and stored in `meta/last-run`.
- Until the first run, `/api/*` answers 503 `snapshot_unavailable`.
- Every manual run spends from the same 2,500-a-month quota as production.

### `netlify dev` never touches the production store

Checked on 2026-10-24 against netlify-cli 27.14.0
(`dist/commands/dev/dev.js` and `dist/lib/blobs/blobs.js`):

- `netlify dev` always starts its own `BlobsServer` (from
  `@netlify/blobs/server`) on a random localhost port, with a random UUID as
  its token, and sets `NETLIFY_BLOBS_CONTEXT` to point at it. It does this
  linked or not, online or `--offline`. There is no flag that points it at
  the production store.
- Our code calls `getStore({ name })` with no `siteID` or `token`, so it can
  only use that context. A production Blobs token is never issued to a local
  process.
- Files live in `.netlify/blobs-serve/entries/<siteID>/site:fuel-finder/...`.
  The real site ID appears in the path because the folder is linked, but it
  is only a folder name. An `unlinked/` folder there is from before the link.

So local `auth/token`, `auth/failure`, `meta/last-run` and the snapshot are
all separate from production's.

**The catch: the credentials are not separate.** When the folder is linked
and not `--offline`, `netlify dev` injects the site's environment variables
for all scopes, so a local snapshot run uses the production API.NSW key and
secret (or `.env`'s, which are the same). Two consequences:

- Every local run spends the same monthly quota as production.
- The lockout guard counts failures **per store**. A local run cannot see a
  production `auth/failure`, and vice versa. If the credentials stop working,
  production stops itself after 2 failures, but a local run in between could
  be the third consecutive failure that API.NSW locks the account on. **If
  `/api/status` reports a failed run, do not run the snapshot locally until
  the cause is known.**

Windows needs Developer Mode, because Netlify bundles functions with NFT and
recreates pnpm's symlinks. Install the CLI with npm (`npm install -g
netlify-cli`); `pnpm dlx` does not work for it.
