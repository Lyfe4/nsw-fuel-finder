# Queensland: research and plan (round 15)

Researched 2026-10-29. Planning only: nothing here is built yet. The aim is to
add Queensland's live prices, and later its history, without the two states
being able to break each other.

Sources, tagged as in `docs/api-notes.md`:

- **[manual]** _Fuel Prices Qld Direct API (OUT) v1.6_ (Informed Sources,
  March 2023), the copy in `private/qld/` (gitignored). It is also public at
  fuelpricesqld.com.au/documents.
- **[swagger]** the production Swagger at
  `https://fppdirectapi-prod.fuelpricesqld.com.au/swagger/docs/v1`.
- **[licence]** _Fuel Price Data Licence Terms and Conditions - 2024_, the
  `LimitedUseLicence.pdf` linked from fuelpricesqld.com.au.
- **[live]** the five calls listed below, made 29 October 2026.
- **[open data]** the "Fuel price reporting 2026" dataset on data.qld.gov.au,
  CC BY 4.0, and its August 2026 file, downloaded and profiled.
- **[code]** this repository at `ef373af`.

## Summary

| Question            | Answer                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Can we publish?** | **Not as things stand.** The licence lets a _data consumer_ use the data for its own purposes only. Publishing prices on a public site needs _publisher_ status (see 1.6). |
| Auth                | One static token in a header, `Authorization: FPDAPI SubscriberToken=<GUID>`. No token exchange, no documented lockout                                                     |
| Endpoints we'd use  | `GetSitesPrices` (prices, every run) and `GetFullSiteDetails`, `GetCountryBrands`, `GetCountryGeographicRegions` (reference, once a day)                                   |
| Size and speed      | Prices 804 kB raw (6,986 rows), 381 ms. Sites 628 kB (1,807 sites), 127 ms. Regions 853 kB. All gzipped on the wire **[live]**                                             |
| Limits              | Prices "not more often than once per minute"; reference data once a day **[manual]**. No monthly quota is published, no rate-limit headers were sent **[live]**            |
| Freshness rule      | Retailers report within 30 minutes; a **publisher** must show a change within 30 minutes **[licence 2.3]**                                                                 |
| Prices              | Tenths of a cent: `2399` is 239.9 c/L. `9999` means unavailable at that site **[manual] [live]**                                                                           |
| Timestamps          | `TransactionDateUtc` is UTC but has **no `Z`**: `2026-09-19T21:09:50.913` **[live]**                                                                                       |
| Station IDs         | 8-digit integers (61290151–61678190); the same IDs as the open-data CSVs **[live] [open data]**                                                                            |
| History             | Monthly CSVs on data.qld.gov.au, CC BY 4.0, changes only. August 2026 is the newest (published 2 September); September is not out on 29 October                            |

## Live verification (2026-10-29)

Five calls, approved by the owner beforehand, 15 seconds apart. The token was
read from `.env` by a scratchpad script and never printed. Bodies were kept in
the session scratchpad, not the repository.

| Time (UTC) | Call                                           | Status | Time   | Size (raw) |
| ---------- | ---------------------------------------------- | ------ | ------ | ---------- |
| 00:47:27   | `Subscriber/GetCountryFuelTypes`               | 200    | 151 ms | 601 B      |
| 00:47:42   | `Subscriber/GetCountryBrands`                  | 200    | 68 ms  | 2.0 kB     |
| 00:47:57   | `Subscriber/GetCountryGeographicRegions`       | 200    | 162 ms | 853 kB     |
| 00:48:13   | `Subscriber/GetFullSiteDetails` (QLD, level 3) | 200    | 127 ms | 628 kB     |
| 00:48:28   | `Price/GetSitesPrices` (QLD, level 3)          | 200    | 381 ms | 804 kB     |

Response headers: `cache-control: no-cache,no-store`, gzip, HSTS, an Azure
`request-context`. No rate-limit, quota or retry headers. The server's `Date`
header ran about 7 seconds ahead of this machine's clock.

---

## 1. The API

### 1.1 Endpoints

All `GET`, all need the token, and all need `countryId=21` (Australia)
**[manual] [swagger]**. Queensland is `geoRegionLevel=3&geoRegionId=1`.

| Method                                    | Returns                                                                                                                                            | Manual's load guidance |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `/Subscriber/GetCountryFuelTypes`         | `{ Fuels: [{ FuelId, Name }] }`, 17 fuels                                                                                                          | Once a day             |
| `/Subscriber/GetCountryBrands`            | `{ Brands: [{ BrandId, Name }] }`, 53 brands                                                                                                       | Once a day             |
| `/Subscriber/GetCountryGeographicRegions` | `{ GeographicRegions: [{ GeoRegionLevel, GeoRegionId, Name, Abbrev, GeoRegionParentId }] }`: 7,305 suburbs (level 1), 662 cities (2), 8 states (3) | Once a day             |
| `/Subscriber/GetFullSiteDetails?…`        | `{ S: [site] }`, 1,807 QLD sites                                                                                                                   | Once a day             |
| `/Price/GetSitesPrices?…`                 | `{ SitePrices: [{ SiteId, FuelId, CollectionMethod, TransactionDateUtc, Price }] }`                                                                | At most once a minute  |
| `/Version`                                | A string (Swagger only; unauthenticated, unused)                                                                                                   |                        |

The Swagger also names a second host, `fppdirectapi-prodau-app.azurewebsites.net`,
which is the same service behind its Azure name. We use the documented
`fppdirectapi-prod.fuelpricesqld.com.au`.

A site **[live]**, values from the manual's own example station:

```json
{
  "S": 61290151,
  "A": "61 Burrowes St",
  "N": "Liberty Surat",
  "B": 86,
  "P": "4417",
  "G1": 182624964,
  "G2": 178465038,
  "G3": 1,
  "G4": 0,
  "G5": 0,
  "Lat": -27.151627,
  "Lng": 149.067712,
  "M": "2019-07-15T05:32:17.627",
  "GPI": "ChIJ…",
  "MO": "",
  "MC": "",
  "TO": "",
  "TC": "",
  "…": "",
  "SUO": "",
  "SUC": ""
}
```

A price **[live]**:

```json
{
  "SiteId": 61290151,
  "FuelId": 2,
  "CollectionMethod": "Q",
  "TransactionDateUtc": "2026-09-19T21:09:50.913",
  "Price": 2399
}
```

What the live data shows:

- **`A` is the street only.** No suburb, state or postcode in it. The suburb
  is `G1`, an ID into `GetCountryGeographicRegions` (level 1); all 1,807 `G1`s
  resolved. Postcode is `P`. So QLD does **not** go through
  `netlify/lib/snapshot/address.ts`; we build the address ourselves:
  `${A}, ${suburb} QLD ${P}`. 87 street lines have leading or doubled spaces.
- **Suburb names** are mixed case except 9 in capitals (`SURAT`). The
  existing title-casing in the browser covers those.
- **`B` (brand)** always resolves against `GetCountryBrands` **[live]**.
- **`M` (last modified)** is null on 239 sites, and has no `Z` either.
- **Opening hours** (`MO`…`SUC`, Monday to Sunday open and close) are empty on
  every site. Unused.
- **`GPI`** is a Google Place ID. Unused (we have coordinates).
- **Coordinates** on every site: latitude −28.997 to −9.751 (the Torres Strait),
  longitude 138.118 to 153.516.
- **Prices:** 6,986 rows, one per site and fuel, no duplicates, no orphans;
  1,785 sites priced, 22 not. All `CollectionMethod: "Q"`. All integers.
- **`9999` (unavailable):** 108 rows today. In August's file, 1,083 of 92,244
  rows, at 244 sites, across every fuel.
- **Implausible prices exist.** One diesel at `319` (31.9 c), one LPG at `999`
  today; in August, rows of `2`, `25` and `9996`. The live path needs the same
  50–600 c/L plausibility bounds the NSW backfill uses
  (`scripts/lib/fuelcheck-history.mjs:39`), or one typo tops a "cheapest" list.
- **Price age** (non-`9999`, at 00:48 UTC): under a day 3,399; 1–7 days 1,914;
  7–30 days 1,427; 30–90 days 203; 90–365 days 37; over a year 6. Similar to
  NSW. The newest was 69 seconds old.
- **Station count is stable:** 1,766 sites in August's file, 1,759 of them
  still in the API, and 48 API sites newer than August.

### 1.2 How often prices change and how often to fetch

- Retailers must report a change within 30 minutes of it happening at the pump
  **[manual, overview]**.
- `GetSitesPrices` returns every current price each call (there is no "changes
  since" method), so one call per run, like NSW.
- The licence's 30-minute rule (1.6) means a 30-minute schedule is **not
  enough** for a publisher: a change could reach a visitor about 32 minutes
  later (30-minute cadence plus the 60-second CDN and browser caches). Every
  **10 minutes** keeps the worst case near 12 minutes and is still a tenth of
  the "once a minute" limit.

### 1.3 Rate limits and quota

- **None numeric beyond the manual's load guidance.** No monthly quota is
  stated in the manual, the licence or the site, and no headers say so. The
  licence says the service "will monitor your access" **[licence 1.2]**.
- Planned use: 144 price calls a day at 10 minutes, plus 3 reference calls a
  day (sites, brands, regions; fuel types are static enough to check weekly):
  **about 4,560 calls a month**. Write to support@fuelpricesqld.com.au to
  confirm this is welcome before launch (it is what the manual asks for, but
  it costs nothing to ask).

### 1.4 Error handling

The manual lists 200, 400 (bad parameter), 401 (unknown token), 403 (API
"refuses to respond"; listed for prices only) and 500.

- **No lockout is documented**, unlike API.NSW's three strikes. But a token is
  the whole credential, and repeatedly presenting a revoked one to a service
  that "monitors your access" is a poor look. So: **401 or 403 stops the QLD
  job until a person resets it**, the same rule as NSW, with its own record
  (`qld/auth/failure`). No unknown-outcome counting is needed: there is no
  token exchange, so a timeout cannot be a hidden refusal.
- 500, timeouts and a `null` or malformed body are retryable (502 from the
  function, so Netlify retries once), as for NSW.
- **The manual reserves the right to add and reorder fields** ("non-breaking"
  changes). Zod's default `z.object` strips unknown keys, so new fields are
  ignored; order never mattered to JSON parsing. Required fields must stay
  required in our schema, so a removed field fails loudly.

### 1.5 Terms of use: what the licence says

The data comes under the _Fuel Price Data Licence Terms and Conditions - 2024_,
between the subscriber and the State of Queensland (Department of Energy and
Climate). In short:

| Clause  | What it says                                                                                                                         | What it means here                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 2.1     | Use for your own purposes, including a backup copy                                                                                   | A data consumer may fetch, store and build, but not show the public               |
| 2.2     | Value-added products allowed if the data is changed in form or combined with other data                                              | Our merged NSW + QLD search qualifies                                             |
| **2.3** | **Only a publisher may publish**; must prohibit further publication; prices current within 30 minutes, other details within 24 hours | **The blocker.** And the reason for the 10-minute schedule and daily site refresh |
| 2.4     | Giving data to a third party to publish needs written approval                                                                       | Not our case                                                                      |
| 3.1     | No distribution to third parties except under 2.3/2.4                                                                                | `/api/*` is public JSON: it is distribution, so it is covered only as a publisher |
| 4.2/4.3 | A set notice, "© State of Queensland…" or "Based on or contains data provided by the State of Queensland…", with a disclaimer        | Verbatim text in the footer (section 6)                                           |
| 4.4     | Distinguish data from the Licensor from other sources                                                                                | Each QLD station says where its price is from; NSW's say FuelCheck                |
| 4.7     | No implied endorsement; no Queensland Government logos or marks                                                                      | Text credit only, no logo                                                         |
| **4.8** | The Licensor may ask for usage data; for publishers, Google-Analytics-style monthly active, new and returning users by region        | **Conflicts with "no analytics".** See below                                      |
| 1.5     | Either side may end it on 20 business days' notice; a publisher that is not current can be cut off on 3 days'                        | A QLD outage on our side is a licence risk, not just a UX one: monitoring matters |
| 1.4/4.1 | A fee of $1 "payable upon demand"                                                                                                    | Pay it if asked                                                                   |
| 5       | Audits                                                                                                                               | Keep these docs; they show what we do                                             |

### 1.6 What has to happen before QLD prices go public

1. **Publisher status.** The owner is approved as a _data consumer_. Clause 4.6
   says a data consumer that wants to become a publisher "must complete a new
   sign up form". Do that, or get written confirmation from
   fuelprices@epw.qld.gov.au that this site is covered. **Nothing QLD reaches
   the public site until one of these is in writing.**
2. **Ask about usage data (4.8) at the same time.** Fuel Finder has no
   analytics by design (README, Privacy). Netlify's dashboard has request and
   bandwidth counts but not users by region. Ask whether aggregate monthly
   request counts would do, rather than add a tracker. If analytics turn out
   to be a condition, that is the owner's decision, and it would change the
   privacy note.
3. **"Must prohibit further publication" (2.3).** Add a line to
   `/privacy.html` (or a short terms note) and the footer: QLD prices may not
   be republished. The `/api` is public JSON, so this is the only lever; the
   rate limits already stop wholesale scraping.

Building and testing can go ahead meanwhile: fetching and storing the data for
our own purposes is what a data consumer may do (2.1). The phase plan (section 7) keeps QLD off the public site behind a switch until step 1 is done.

---

## 2. Fit with the architecture

### 2.1 The rule: two pipelines that share nothing that can fail

Today one scheduled function, one snapshot, one lockout record, one call
count, one `meta/last-run`. The code survey found the coupling points:

- `netlify/lib/snapshot/run.ts:32-94` runs everything in one `try`; one
  failure fails the run, and `worthRetrying` (`run.ts:102-106`) retries all of
  it.
- The partial-response guard compares one `stationCount`
  (`run.ts:49-50`, `MIN_STATION_RATIO = 0.5`). With both states in one
  snapshot, a run where NSW failed and QLD succeeded would be refused, and a
  run where QLD silently returned nothing would pass.
- `KEYS` in `netlify/lib/store.ts:36-46` are global: `auth/failure`,
  `meta/last-run`, `meta/calls/…`.

So QLD gets **its own scheduled function, its own keys and its own snapshot**,
and only the `/api` function reads both. NSW's code path, keys and blobs do
not change at all in phase 1.

```
every 30 min                                   every request
snapshot      (NSW, unchanged) ──▶ snapshot/v1/latest      ─┐
                                   meta/…, auth/…, history/… │
every 10 min                                                 ├──▶ api: read each
snapshot-qld  (new)            ──▶ qld/snapshot/v1/latest   ─┘    independently,
  daily: sites, brands, regions ─▶ qld/reference/v1               merge in memory
                                   qld/meta/…, qld/auth/…,
                                   qld/history/…
```

### 2.2 The QLD job

`netlify/functions/snapshot-qld/snapshot-qld.ts`, `config.schedule:
'*/10 * * * *'`, production only (the same `runsIn()` check as
`snapshot.ts:28-31`). Each run:

1. `assertNotLocked` on `qld/auth/failure`; stop if set.
2. If `qld/reference/v1` is missing or older than 24 hours (by its own
   `fetchedAt`), call `GetFullSiteDetails`, `GetCountryBrands` and
   `GetCountryGeographicRegions`, and store only what we need: per site the
   name, street, suburb name, postcode, brand name, lat, lng (about 250 kB,
   not the 853 kB region list). Done in its own step: if it fails, the run
   carries on with the previous reference data, and `/api/status` reports it
   once it is over 26 hours old (the licence's 24 hours plus a margin).
3. `GetSitesPrices`; join to the reference; drop `9999`, implausible prices
   and unknown fuel IDs; build stations in the same shape as NSW's.
4. Partial guard against the previous **QLD** count only.
5. Write `qld/snapshot/v1/latest` with metadata `{ fetchedAt, stationCount }`.
6. Update `qld/history/v1/<Brisbane day>`, fold a slice into per-station
   files, write `qld/meta/last-run`, count calls in `qld/meta/calls/YYYY-MM`.

Worst-case run: 4 calls at about 0.1–0.4 s each, well inside the 30-second
limit for scheduled functions. A 10-second timeout per call, as NSW.

Most of `run.ts` is reusable if it takes the source as a parameter (keys,
client, builder, time zone), rather than copied. That refactor is the main
risk to NSW in phase 1, so it lands with NSW's existing tests unchanged and
passing (`run.test.ts:20-43` pins NSW's exact key list).

### 2.3 Credentials

- `QLD_FPD_TOKEN`, set in the Netlify UI for the **production** context,
  **Functions** scope only, as `FUEL_API_KEY` is (`netlify.toml`
  `[build.environment]` comment). Never `VITE_`-prefixed. Deploy previews
  never get it, and the job skips previews anyway.
- Checked to be a GUID before use; a missing or malformed token is
  `not_configured` (200, no call made), as NSW.
- Never logged: the client's error messages carry the status and path only.
- `.env.example` gains `QLD_FPD_TOKEN=` with a comment.
- `scripts/auth-reset.mjs` hard-codes `auth/failure` (line 24); it gains
  `--source qld`.

### 2.4 Call budget

| Source  | Schedule | Data calls/month | Other         | Total/month | Limit                         |
| ------- | -------- | ---------------- | ------------- | ----------- | ----------------------------- |
| API.NSW | 30 min   | 1,488            | ~62–93 token  | ~1,580      | 2,500 (budget 2,000)          |
| QLD     | 10 min   | 4,464            | ~93 reference | ~4,560      | none published; ≤1/min prices |

`/api/status` alerts for QLD at more than 6,000 calls in a month (about 30%
over plan), which can only mean a loop or a retry storm.

Netlify (Legacy Free, 125,000 invocations per site a month): today about
1,488 snapshot runs, about 2,900 UptimeRobot checks and the visitors' `/api`
calls. QLD adds 4,464 runs. Comfortable. Blobs writes per QLD run: the
snapshot (about 350 kB for 1,785 stations, estimated from NSW's 875 kB for
2,397 stations with more fuels each), the day file, a 200-station fold slice.

### 2.5 Blobs layout

Everything QLD lives under `qld/` in the same `fuel-finder` store. NSW's keys
keep their names, so no migration and no change to the backfill or
`auth:reset` defaults.

| Key                         | Contents                                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| `qld/snapshot/v1/latest`    | `{ version, fetchedAt, stations }`, NSW's station shape, `state: 'QLD'` |
| `qld/reference/v1`          | `{ fetchedAt, sites: {id: {...}}, brands, fuels }`                      |
| `qld/auth/failure`          | `{ version, rejected, lastAt, detail }`                                 |
| `qld/meta/last-run`         | The same `RunSummary` shape as NSW                                      |
| `qld/meta/calls/YYYY-MM`    | `{ version, month, reference, prices, runs }`, Brisbane month           |
| `qld/history/v1/YYYY-MM-DD` | The Brisbane day's `[low, high, last]` per station per fuel             |
| `history/v2/live/qld-…`     | Per-station files; same key family as NSW (codes are prefixed)          |
| `qld/history/v2/progress`   | The QLD fold's own progress                                             |

The per-station history files stay in `history/v2/live/` and
`history/v2/backfill/` because `/api/history` looks them up by station code
alone; the `qld-` prefix keeps them apart.

**Station codes are prefixed: `qld-61290151`.** NSW codes are 1–5 digits and
QLD IDs 8 digits, so they do not collide today (checked: none equal), but
codes share one namespace in blob keys, the history day files, favourites in
`localStorage`, `?station=` and `?history=`. A prefix makes a clash
impossible rather than unlikely. The existing validation, `^[\w-]{1,32}$`
(`netlify/functions/api/stations.ts:24`, `src/features/search/searchState.ts:80`,
`src/features/favourites/favourites.ts:26`), already accepts it. NSW codes
stay unprefixed, so no NSW favourite or shared link changes.

### 2.6 The API reads two snapshots

- `snapshotSource.ts` becomes one source per state, each with its own cache,
  version (`fetchedAt` metadata) and 30-second strong recheck. Today's logic is
  unchanged; it is just instantiated twice.
- **Either can be missing.** Searches merge whatever is available. Only when
  both are unavailable is the answer 503 `snapshot_unavailable`.
- `PricesResponse` gains `sources: { id: 'nsw' | 'qld', fetchedAt, stale }[]`,
  listing only the sources whose stations are in the answer, plus
  `unavailable: ('nsw' | 'qld')[]` when a source that would have contributed
  could not be read. Both additive: an older page ignores them.
  `fetchedAt` and `stale` stay, as the older of the two, so nothing breaks.
- The QLD snapshot's station schema is NSW's with `state` widened to
  `'NSW' | 'ACT' | 'QLD'`. Reading NSW's existing v1 blob with a wider enum is
  safe; the NSW writer does not change.
- `changeCents` reads each source's own previous day file
  (`previousDay.ts`), keyed by its own time zone.
- `/api/stations?codes=` and `/api/history` route a `qld-` code to QLD's data.
  The "FuelCheck no longer lists that station" message
  (`stations.ts:87,103`, `LazyHistoryView.tsx:73`, `FavouritesPanel.tsx:97`)
  becomes source-neutral.

### 2.7 `/api/status` per source

Today `StatusResponse` (`shared/api.ts:86-100`) has one `lastRun`, one
`served` and one `callsThisMonth`. Add:

```ts
sources: {
  nsw: SourceStatus; // the same fields as today
  qld: SourceStatus & { referenceFetchedAt: string | null };
}
```

and keep the existing top-level fields as NSW's, so nothing reading them
breaks. Each problem is prefixed with its state ("QLD: the last scheduled
run failed (timeout)."). **Any source's problem still makes the status 503**:
that is a monitoring signal, not a broken search, and a QLD outage is a
licence risk (1.5), so it should email the owner. Until QLD is switched on
publicly (phase 1c), QLD problems are reported but do not cause a 503, so
building it cannot page anyone.

### 2.8 Monitoring

- UptimeRobot on `/api/status` covers both, with no new monitor (and no extra
  invocations).
- `netlify logs --function snapshot-qld` for the QLD job's own log lines.
- The QLD call count in `/api/status`. No external dashboard exists for it.

### 2.9 Real usage, library behaviour, deployment reality

**Who gets confused or blocked:**

- **Tweed Heads and Coolangatta are one town** across the border. A 5 km
  search from Tweed Heads today finds 8 NSW stations and no QLD ones; with QLD
  it adds Coolangatta's (Hope Energy, 2.2 km). At 25 km it is 25 NSW and 52
  QLD stations. Test: a Tweed Heads search lists Coolangatta's stations by
  distance, with QLD addresses.
- **A Coolangatta resident types `4225`.** Today that is refused as "not a
  NSW postcode" (`validate.ts:97`, `/^[12]\d{3}$/`). Test: `4225` resolves.
- **"Ashfield", "Auburn", "Belmont"...** 247 QLD suburb names are also
  NSW/ACT names. Typed exactly, each becomes a 409 "which one?" where today it
  resolves at once. The suggestions already show the state, so most people pick
  a label; the 409's choices should list the NSW one first only if we decide
  to favour it, and that is a product call (section 4.3). Test: typing
  "Ashfield" offers both, labelled by state.
- **Daylight saving.** From October to April, Brisbane is an hour behind
  Sydney. Prices "as of 2:30 pm" in Sydney time would be wrong for a Brisbane
  visitor (section 6). Test: a QLD snapshot fetched at 03:00 UTC on 1 November
  reads "1:00 pm" for QLD, "2:00 pm" for NSW.
- **Out of stock.** `9999` is dropped, so the station does not appear for that
  fuel, as a station that does not sell it. Simple and honest; a "temporarily
  unavailable" line in the card is a later nicety.
- **Favourites across the border** work unchanged: codes are just strings.

**Library and platform behaviour this relies on:**

| Call                                       | Behaviour relied on                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Date.parse('2026-09-19T21:09:50.913')`    | **A date-time with no offset is parsed as local time** (ECMAScript). Netlify functions run in UTC so it would happen to work there, and fail on any developer machine. Append `Z` explicitly, with a test in `Australia/Brisbane` and `Australia/Sydney` |
| `z.object` (Zod)                           | Strips unknown keys by default, so the Aggregator's added fields are ignored. Not `.strict()`                                                                                                                                                            |
| `fetch` + `AbortSignal.timeout`            | Rejects with a `TimeoutError`; maps to the existing `timeout` kind. The response is gzipped; Node's fetch decompresses it transparently                                                                                                                  |
| Netlify scheduled functions                | Cron in UTC; 30-second limit; production deploys only; re-invoked once after a 5xx (seen once for NSW, 4 s later); each schedule its own function                                                                                                        |
| `@netlify/blobs`                           | `getStore()` per invocation, never cached (memory: the round 3b stall); strong reads where freshness matters; no compare-and-swap, so **each key has one writer**                                                                                        |
| `Intl.DateTimeFormat` `Australia/Brisbane` | No DST, so day boundaries are fixed UTC+10                                                                                                                                                                                                               |
| Netlify CDN (`Netlify-Vary`)               | No new query parameters, so cache keys are unchanged                                                                                                                                                                                                     |
| CSP `connect-src`                          | Unchanged: only the server calls the QLD API                                                                                                                                                                                                             |

**Two machines, two clocks, retries:**

- The NSW and QLD jobs run on different instances, at overlapping times
  (both at :00 and :30). **No key is written by both**, which is why
  everything QLD is under `qld/`. The shared history families
  (`history/v2/live/…`) are disjoint by code prefix.
- An `/api` instance may hold a QLD snapshot 10 minutes newer than its NSW
  one, or the reverse. Each source carries its own `fetchedAt` and `stale`;
  nothing assumes they match.
- The QLD server's clock was about 7 s ahead of this machine. A price stamped
  slightly in the future is clamped to "now", not dropped.
- A retried QLD run repeats its calls and is counted; it never touches NSW.

---

## 3. Data mapping

### 3.1 Fuel types

| QLD `FuelId` | QLD name (API)                      | CSV name       | Rows today | Ours  | Note                                         |
| ------------ | ----------------------------------- | -------------- | ---------- | ----- | -------------------------------------------- |
| 2            | Unleaded                            | Unleaded       | 1,596      | `U91` |                                              |
| 12           | e10                                 | e10            | 992        | `E10` | Our label is FuelCheck's "Ethanol 94" (4.3)  |
| 5            | Premium Unleaded 95                 | PULP 95/96 RON | 936        | `P95` |                                              |
| 8            | Premium Unleaded 98                 | PULP 98 RON    | 1,301      | `P98` |                                              |
| 3            | Diesel                              | Diesel         | 1,056      | `DL`  |                                              |
| 14           | Premium Diesel                      | Premium Diesel | 971        | `PDL` |                                              |
| 4            | LPG                                 | LPG            | 86         | `LPG` |                                              |
| 19           | e85                                 | e85            | 46         | `E85` | FuelCheck calls it "Ethanol 105"             |
| 16           | Bio-Diesel 20                       |                | 0          | `B20` | Map it; no prices today                      |
| 21           | OPAL                                | OPAL           | 2          | none  | Low-aromatic fuel at 2 remote sites; dropped |
| 6, 11, 13    | ULSD, LRP, Premium e5               |                | 0          | none  | Dropped; logged if they ever appear          |
| 22, 23       | CNG, LNG                            |                | 0          | none  | As NSW                                       |
| 999, 1000    | e10/Unleaded, Diesel/Premium Diesel |                | 0          | none  | Combined search codes, like NSW's `E10-U91`  |

Unknown IDs are dropped and counted in the run summary, never guessed.
`shared/fuelTypes.ts` needs no new code; the QLD map lives beside the QLD
client.

### 3.2 Stations, brands and addresses

- **Code:** `qld-${S}` (2.5).
- **Name:** `N`, trimmed and whitespace-collapsed (as `build.ts` does for NSW).
- **Brand:** `GetCountryBrands[B].Name`. QLD's names differ from FuelCheck's
  for the same chains: "7 Eleven" vs "7-Eleven", "EG Ampol", "Reddy Express"
  (Shell's Coles Express successor). The brand filter is per result set, so
  this only shows where both states are in one list. A small alias table
  ("7 Eleven" → "7-Eleven") is enough; checked against the NSW snapshot's
  brands when built. "IOR Pty Ltd" and "Pacific Fuel Solutions" are fine as
  they are.
- **Address:** `${A}, ${suburb} QLD ${P}`, with `A` whitespace-collapsed. The
  browser's title-casing (`src/lib/format.ts`, whose `STATES` already include
  QLD) handles capitals.
- **Suburb:** the level-1 region name from `G1`.
- **Mungindi** straddles the border; the QLD site uses QLD postcode 4497.
  The open-data notes warn that Mungindi's prices can carry a NSW postcode in
  some files.
- **Duplicates across the border:** none. No QLD site is within 200 m of a
  NSW station (checked against the 24 October NSW snapshot), and no NSW
  station lies north of −28.17. No de-duplication logic is needed; a test
  should keep checking that no two stations from different sources are within
  50 m, and log if they are.

### 3.3 Prices and timestamps

- `priceCents = Price / 10` (2399 → 239.9), the same unit NSW stores.
- Drop `Price === 9999` (unavailable) and anything outside 50–600 c/L.
- `TransactionDateUtc` + `Z` → ISO UTC, clamped to the run's time if in the
  future (2.9).
- **Time zone:** QLD is `Australia/Brisbane`, UTC+10 all year. Server-side
  days (history day files, the calls month, "yesterday" for `changeCents`)
  use the source's own zone: `sydneyDay` (`netlify/lib/upstream/time.ts:67-81`)
  generalises to `dayIn(zone, date)`.

### 3.4 Near the border

Searches already work by distance from a point, so a merged station list just
works: a station is included if it is within the radius, whichever state it is
in. Prices are in the same unit, so "cheapest" and the 50 L summary compare
like with like. Each station's address names its state, and the card names
its source (licence 4.4).

---

## 4. Search

### 4.1 The gazetteer

`scripts/build-gazetteer.js` takes ABS state codes 1 and 8 and postcodes
2000–2999. QLD is state code 3 and postcodes 4000–4999 (checked on the ABS
service today):

|                      | NSW + ACT (today)  | QLD added     | Total                    |
| -------------------- | ------------------ | ------------- | ------------------------ |
| Suburbs (SAL 2021)   | 4,682 (4,678 kept) | 3,235         | about 7,900              |
| Postcodes (POA 2021) | 638 (637 kept)     | 433           | about 1,070              |
| `gazetteer.json`     | 293 kB (88 kB gz)  | about +200 kB | about 500 kB (150 kB gz) |

- It is **server-only**, bundled into the `api` function (`gazetteer.ts:1`), so
  the browser bundle does not change and no client budget applies. No check
  guards its size today: add a test that it stays under 700 kB.
- ABS qualifiers for QLD: 503 names carry one, often only the state,
  `Abbotsford (Qld)`, sometimes a place too, `Albion (Brisbane - Qld)`.
  `splitName` (`build-gazetteer.js:97-102`) strips `- NSW` and `- ACT`; it
  needs `- Qld`, and a qualifier that is only the state is dropped, since the
  label already says `QLD`.
- `gazetteer.ts:38` coerces every state that is not `ACT` to `NSW`; the state
  type gains `QLD`.
- `gazetteer.test.ts:6-29` asserts the NSW box; it becomes a per-state check.

### 4.2 The bounding box and query parsing

`NSW_BOUNDS = { minLat: -37.6, maxLat: -28.1, minLng: 140.9, maxLng: 153.7 }`
(`validate.ts:12`) refuses almost all of Queensland. It becomes a list of
boxes, one per covered state; QLD's is latitude −29.2 to −9.0, longitude 137.9
to 153.7 (QLD sites span −29.0 to −9.75 and 138.1 to 153.5). Two boxes rather
than one big rectangle, so "outside the area we cover" still means something
for Victoria and the NT.

Also in `validate.ts`: `POSTCODE` (`:97`) and the `SUBURB` pattern's state and
postcode groups (`:99`) accept `QLD` and `4\d{3}`; the error texts (`:78`,
`:113`) and `places.ts:229` ("in NSW or the ACT") name all three;
`searchState.ts:159`'s `splitPlace` and `addressCase.ts:19` accept `QLD`.

The map has no bounds of its own: it fits the results (`mapData.ts:105-125`).
Nothing to change.

### 4.3 Decisions for the owner

- **Same-name suburbs.** 247 names exist in both. Keep today's rule (a 409
  with the choices, as Griffith NSW/ACT already does) or prefer one state?
  Recommendation: keep the 409; it is honest, and the suggestions resolve it
  before Enter for most people.
- **"Ethanol 94".** FuelCheck's name for E10. Queenslanders say "E10". Show
  "E10" for both? Recommendation: yes, it is the more widely understood name;
  same for "E85" over "Ethanol 105". A small change to `shared/fuelTypes.ts`.

---

## 5. History

### 5.1 The open data

- Dataset per year on data.qld.gov.au: "Fuel price reporting 2026" (CKAN id
  `0dfad294-…`), **CC BY 4.0** (not ShareAlike, unlike NSW's).
- One CSV a month, "changes only": every price change, about 90,000 rows and
  13–16 MB a month (August: 92,244 rows, 13.0 MB, 1,766 sites).
- Columns: `SiteId, Site_Name, Site_Brand, Sites_Address_Line_1, Site_Suburb,
Site_State, Site_Post_Code, Site_Latitude, Site_Longitude, Fuel_Type, Price,
TransactionDateutc`. The header starts with a byte-order mark; addresses with
  commas are quoted (1,407 rows in August), so it needs a real CSV parser.
- `TransactionDateutc` is `dd/MM/yyyy HH:mm`, UTC, to the minute.
- `Fuel_Type` uses the CSV names in 3.1. `Price` in tenths of a cent, `9999`
  out of stock, and the same implausible values as live (`2`, `25`, `9996`).
- **Publication lag is irregular.** August 2026 came out on 2 September;
  September is not out on 29 October. March 2026 came out on 2 June, with
  January to May all re-touched that day. So the backfill script must
  tolerate a missing month and be safe to rerun.

### 5.2 Station matching: by ID

Unlike FuelCheck's files (which have no station codes and needed address and
name matching, 99.2%), **`SiteId` is the API's `S`**. 1,759 of August's 1,766
sites are in today's API; the other 7 have closed or changed ID and are simply
left out. No fuzzy matching.

### 5.3 Backfill size and cost

- Four months: 4 CSVs, about 60 MB downloaded once (cached, as
  `.history-backfill/cache/` does for NSW).
- About 1,800 per-station files of about 15 kB (NSW's backfill files are
  ~15 kB for three months): **about 27 MB** in Blobs, in one upload of 1,800
  writes. It needs the owner's go-ahead (a production write) and a
  short-lived Netlify token, like `history:backfill`.
- **No QLD API calls.** Open data only.
- The gap between the last published month and our own QLD snapshots starts
  will be drawn exactly as the NSW October gap is ("No data, …"), until the
  months are published.

### 5.4 Licence and credit

The CSVs are CC BY 4.0, a different licence from the API's. The daily
low/high/last derived from them can be shared under CC BY 4.0 with credit:
"Queensland Government, Fuel price reporting, data.qld.gov.au, CC BY 4.0".
QLD's derived history from our own snapshots is API data, so it is under the
API licence (and its 4.3 notice), not CC BY. `HistoryResponse` already carries
per-file sources and licences (`shared/api.ts:159`); it gains a
`qld-open-data` kind, and the history view credits by source.

---

## 6. UI and naming

### 6.1 What changes on screen

- **Masthead region:** "NSW · ACT · QLD" (`App.tsx:25-28`), screen-reader text
  "NSW, ACT and QLD". `docs/design-system.md` already treats the region as
  content, not identity.
- **"Prices as of", per state.** `Results.tsx:267` says "… prices as of 2:30
  pm, from FuelCheck." With `sources` (2.6):
  - one source: "Unleaded 91 prices as of 2:30 pm, from FuelCheck." or "… as
    of 1:30 pm, from Fuel Prices Qld." in that state's own time;
  - both (border searches): "Unleaded 91 prices as of 2:30 pm (NSW) and 1:30
    pm (Qld)." The zone matters only from October to April; outside daylight
    saving both say the same clock.
  - `src/lib/format.ts:7`'s single `TIME_ZONE` becomes a parameter. Station
    rows show price _age_ ("3 h"), which needs no zone.
- **Stale and unavailable notices** (`Notices.tsx:126`) name the source: "Our
  last update from Fuel Prices Qld was 2 hours ago. NSW prices are current."
  When one source is unreadable, a notice says its stations may be missing.
- **Out-of-area message** (`Notices.tsx:89-91`): "Fuel Finder covers NSW, the
  ACT and Queensland."
- **Station card:** a one-line source credit for QLD stations ("Price from
  Fuel Prices Qld"), licence 4.4. NSW cards are unchanged.
- **Footer** (`App.tsx:34-53`), in the existing `--step--2` credit style:
  - "Queensland prices based on or containing data provided by the State of
    Queensland (Department of Energy and Climate) 2026." followed by the 4.3
    disclaimer, verbatim, and "Not to be republished." (2.3). Long; it can sit
    behind a "Queensland data notice" disclosure in the footer as long as the
    text is on the page.
  - Phase 2: the CC BY 4.0 credit for QLD history.
- **`index.html`, `site.webmanifest`, `package.json`, README:** "NSW, the ACT
  and Queensland".
- **Privacy note:** unchanged unless 4.8 forces analytics (1.6).
- **Screenshots and fixtures:** a Tweed Heads search makes a good mixed
  example for `pnpm screenshots`.

### 6.2 Should the name change now?

**No, not in this round.** Recommendation:

- **Product name:** already "Fuel Finder", region-neutral. Keep.
- **GitHub repository** (`Lyfe4/nsw-fuel-finder`): rename to `fuel-finder`
  once QLD is public. GitHub redirects the old URL, so links and clones keep
  working; update the README badge links and the `gh` remote.
- **Site URL** (`nsw-fuel-finder.netlify.app`): **do not rename the Netlify
  subdomain**. A renamed subdomain does not redirect, so shared links,
  UptimeRobot and search results would break. Instead, when QLD launches, add
  `fuel.calvinrdevelopment.com` as the primary domain (the zone is already
  Netlify DNS in the same team; the owner makes DNS changes). Netlify then
  redirects the `netlify.app` name to it, and the canonical and Open Graph
  URLs follow at the next build (round 7 made them domain-aware).
- Doing either before QLD is public would advertise a state we do not serve.

---

## 7. Phased build plan

### Phase 0: licence (owner, before anything public)

- Publisher sign-up (or written confirmation), the 4.8 usage-data question,
  and a note to support@fuelpricesqld.com.au about a 10-minute schedule.
- **Effort:** an email or form; the wait is theirs. **Blocks** phase 1c.

### Phase 1a: QLD pipeline, dark (one round)

- Refactor `runSnapshot` to take a source definition; NSW behaviour and keys
  identical (its tests unchanged).
- QLD client, schemas (with the `Z` fix), reference refresh, builder, fuel and
  brand maps, `qld/` keys, `snapshot-qld` on `*/10`, call counting,
  `auth:reset --source qld`, `/api/status` per source with QLD non-paging.
- Fixtures: trimmed copies of today's five responses (a few dozen sites,
  including Coolangatta and a `9999`, an implausible price and a null `M`),
  replayed through `fakeUpstream.ts`, which routes by path.
- **Production write:** once merged, `snapshot-qld` writes `qld/…` keys in
  production every 10 minutes. That is a standing production Blobs write, so
  merging needs the owner's explicit go-ahead.
- **Effort:** medium-large. **Risk:** the refactor touching NSW; mitigated by
  NSW's existing tests and by comparing `meta/last-run` before and after.

### Phase 1b: search, merged results, UI (one round)

- Two snapshot sources in `/api`; `sources` and `unavailable` in
  `PricesResponse`; prefixed codes through stations and history routes.
- Gazetteer with QLD; boxes; query parsing; per-state time zones; the copy in
  6.1; footer notice.
- Behind a production switch (an env var, `QLD_PUBLIC`, read by `/api`): off,
  `/api` ignores QLD entirely, so a deploy preview can be tested with it on.
- **Effort:** medium-large (much of it text, tests and fixtures).

### Phase 1c: switch on (after phase 0)

- Set `QLD_PUBLIC`, make QLD problems page, update README, decisions and
  Baseline, screenshots. Then the domain (6.2), if the owner wants it.

### Phase 2: history (one round, any time after 1a)

- `scripts/build-qld-history-backfill.mjs` (CKAN, CSV, ID matching, same
  per-station format, `qld-open-data` source), the QLD live fold, the history
  view's credits.
- Upload: owner's go-ahead, short-lived token, about 27 MB.
- **Effort:** medium. Simpler than NSW's (no matching), but the first time a
  second licence appears in one chart.

### Risks

| Risk                                                                   | Likelihood     | Mitigation                                                                       |
| ---------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| Publisher status refused or slow; usage-data condition needs analytics | Medium         | Phase 1 is built dark; nothing public until settled                              |
| The shared-run refactor changes NSW behaviour                          | Low–medium     | NSW tests untouched; compare NSW `meta/last-run` and calls for a day after merge |
| A QLD outage makes us "not current" under 2.3 and risks termination    | Low            | 10-minute schedule, `/api/status` paging, UptimeRobot                            |
| Timestamps parsed as local time                                        | High if missed | Explicit `Z`; tests under two `TZ`s                                              |
| One typo price tops the cheapest list                                  | Seen today     | 50–600 c/L bounds, tested with today's 31.9 c diesel                             |
| 247 shared suburb names cause more "which one?" answers                | Certain        | Accepted; suggestions show the state                                             |
| The Aggregator changes field names                                     | Low            | Zod fails the run; `/api/status` reports `bad_response`; previous snapshot kept  |
| Function bundle and cold start grow with the gazetteer                 | Low            | Size test; measure cold start on the preview                                     |

### Tests to add

- QLD client: header format; 401 and 403 stop and record; 500 and timeout
  retryable; token never in any error or log string.
- Builder: `Price / 10`; `9999` and out-of-bounds dropped; unknown fuel IDs
  counted; address built from `A`, `G1` and `P`; brand alias; timestamp with
  `Z` appended, under `TZ=Australia/Brisbane` and `TZ=Australia/Sydney`.
- Isolation: QLD job failing (every error kind) leaves NSW's snapshot,
  `meta/last-run`, `auth/failure` and calls record byte-identical, and the
  reverse. NSW's `run.test.ts` key list unchanged.
- API: each source unavailable in turn (cold instance, unreadable blob, no
  blob): searches still answer from the other, with `unavailable` set; both
  unavailable gives 503.
- Border: a Tweed Heads 5 km search includes Coolangatta's station; `4225`
  resolves; "Ashfield" offers both states; no cross-source pair within 50 m.
- Days: a QLD history day and `changeCents` split at Brisbane midnight;
  "as of" shows each state's own clock in November.
- Status: per-source problems; QLD not paging while `QLD_PUBLIC` is off.
- Gazetteer: under 700 kB; every QLD suburb inside the QLD box.
- Browser checks (`check:browser`): the footer notice is present when QLD is
  on; a mixed search renders both credits.
