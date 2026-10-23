# Decisions

A running log, newest at the bottom. Each entry: the decision, why, and what
else was considered. This feeds the README later.

## 2026-10-21: Setup round

### Mirror Patchbay's toolchain

**Decision:** pnpm 11 (pinned through `packageManager`), Node 22 (`.nvmrc`,
`engines`, Netlify `NODE_VERSION`), Vite 8, React 19, TypeScript 6.0, ESLint 10
flat config, Prettier 3, Vitest 5 + Testing Library + jsdom, Husky +
lint-staged, GitHub Actions CI. Script names are copied from Patchbay.
**Why:** one set of habits across both portfolio projects, and Patchbay's
setup has already been tested in CI and on Netlify.
**Alternatives:** npm (the brief said "npm scripts", but Patchbay runs them
through pnpm, so the scripts are the same and only the runner differs).

### TypeScript stays on 6.0, not 7.0

**Decision:** `typescript: ~6.0.3`, as in Patchbay.
**Why:** `latest` on npm is now 7.0 (the Go-native compiler), but
typescript-eslint 8.72 declares support for `>=4.8.4 <6.1.0` only. Its
type-aware rules use the TypeScript JS API, which 7.0 changes. The tilde
range stops a 6.1 from slipping in before typescript-eslint supports it, and
Dependabot is told to skip TypeScript minors and majors.
**Alternatives:** TS 7 with type-aware linting turned off. Rejected: the
type-aware rules are most of what the lint gate is for.

### Same strictness as Patchbay

**Decision:** `tsconfig.base.json` copied verbatim: `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, `noUnused*`, `noImplicitReturns`, and the rest.
`strictTypeChecked` + `stylisticTypeChecked` in ESLint.
**Why:** this round's code is mostly parsing untrusted upstream JSON, which
is exactly where `noUncheckedIndexedAccess` and strict null checks pay off.

### Three TypeScript projects, not two

**Decision:** `tsconfig.app.json` (browser, DOM, no Node types),
`tsconfig.functions.json` (Netlify function, Node types, no DOM) and
`tsconfig.node.json` (Vite config). `shared/` is in both the app and the
functions projects.
**Why:** the function holds secrets and runs on Node; the app must never be
able to reach `process.env`. Separate projects make either mistake a compile
error. `shared/` holds the API contract (our own response types) so the two
sides cannot drift.
**Alternatives:** one tsconfig with both DOM and Node types. Simpler, but
`process.env.FUEL_API_SECRET` would type-check in a React component.

### Added over Patchbay: max-lines

**Decision:** ESLint `max-lines` 300 (blank lines and comments excluded) on
source files; tests are exempt.
**Why:** stops god components and god modules early, while it is free.
**Alternatives:** none; Patchbay has no equivalent rule.

### Left out from Patchbay

TanStack Router, Zustand, Radix, the CSP/hash plugins, the service worker,
Playwright cross-browser harness, bundle-budget script, the Zod `jitless`
wrapper and its lint rule. None is needed for an empty app; each is added
when a phase needs it (the router and TanStack Query in Phase 1, Leaflet in
Phase 2). Deliberately not adding infrastructure that nothing uses yet.

### Netlify: one function behind an `/api/*` rewrite

> **Still true for /api in round 2. A second, scheduled function now writes the data it reads.**

**Decision:** a single `api` function with an internal router, reached
through a `status = 200` rewrite from `/api/*` in `netlify.toml`.
**Why:** one function means one module-scope token cache shared by every
route in a warm instance, instead of one token per route function. The
rewrite keeps the public URL, and so the CDN cache key, at `/api/...`.
**Alternatives:** one function per route (more cold starts, more token
fetches); Netlify's in-code `config.path` routing (equivalent, but the brief
asked for the redirect in `netlify.toml`, which also keeps routing visible
in one config file).

### Secrets: no VITE_ prefix, server-only

**Decision:** `FUEL_API_KEY` / `FUEL_API_SECRET`, read only in the function.
**Why:** Vite only inlines `VITE_`-prefixed variables into the bundle, so
these names cannot leak to the browser even by accident.

### API v2, filtered to NSW

**Decision:** call the v2 endpoints and drop non-NSW rows in the normaliser.
**Why:** v2 is the maintained version of the spec. v1 is not deprecated, but
v2 is what would survive if one were withdrawn. Its location endpoint already
returns v1-shaped data, so the normaliser handles both shapes anyway.
**Alternatives:** v1, which is NSW only and needs no filter. Rejected
because it is the version more likely to be retired.

### Per-request proxy now, with a snapshot design ready for the quota

> **Superseded in round 2 by the scheduled snapshot. See "Scheduled snapshot replaces the per-request proxy".**

**Decision:** for Phase 1, each `/api/nearby` or `/api/location` cache miss
makes one upstream call. CDN caching is what keeps this inside the quota:
coordinates rounded to ~1 km, `durable` shared cache, 5-minute TTL on
prices.
**Why:** this is what the brief specified, and it is simple. The free plan
is 2,500 calls a month (~80 a day), which is fine for development and light
portfolio traffic. A traffic spike or a bot could exhaust it mid-month,
though, and the over-quota behaviour is undocumented.
**Alternatives:** a scheduled function fetches all NSW prices (`/prices`)
every 30 minutes into Netlify Blobs. `/api/*` then answers from the
snapshot by distance calculation and postcode/suburb match on station
addresses. That is ~1,500 calls a month whatever the traffic, and the call
count no longer depends on visitors. The response contract in
`shared/api.ts` stays the same, so the frontend would not change. To decide
before deploying.

### Coordinates rounded to two decimals

> **Revisited in round 2: kept, for different reasons. See "Coordinate rounding, revisited".**

**Decision:** `/api/nearby` rounds lat/lng to 2 dp (~1.1 km) before calling
upstream. The frontend will round the same way when it builds URLs.
**Why:** neighbours share a CDN cache entry, and no exact position leaves
our server. Distances are off by up to ~0.7 km, so the client will
recompute them from its precise position, using the station lat/lng in
every result.
**Alternatives:** 3 dp (~110 m): accurate distances, but almost every URL
is unique and misses the cache.

### Refuse out-of-area positions, clamp radius

**Decision:** a lat/lng outside a rough NSW box is a 400. The radius is
clamped to 1–25 km, default 5.
**Why:** clamping a position would search somewhere the user is not.
Clamping a radius serves a reasonable request as the largest search we
allow.

### Static fuel-type allowlist

> **Updated in round 2 from live data: 9 fuels, EV removed. See "Fuel list from live data".**

**Decision:** `shared/fuelTypes.ts` lists the codes. Unknown codes are a 400.
**Why:** validating against live `/lovs` would mean a 2 MB fetch on each cold
start, and a quota call each time. The codes have been stable since 2016.
The list is still to be checked against live `/api/reference`.

### Upstream failures are 5xx, never passed through

> **Superseded in round 2: the API no longer calls upstream. Upstream failures now only affect the scheduled job, and show to users as snapshot age.**

**Decision:** status mapping:

- An upstream 401 is a 502 `upstream_auth`.
- An upstream 4xx is a 502 `upstream_error`.
- 5xx or a network failure is a 503, with `Retry-After`.
- A timeout is a 504.
- Errors are never cached.

**Why:** the browser cannot fix our credentials or our request format.
Passing a 401 or 400 through would point at the wrong party.

### Back off after rejected credentials

> **Superseded in round 2 by a guard persisted in Blobs. See "Lockout guard in Blobs".**

**Decision:** after the token endpoint refuses our credentials, the
function does not call it again for five minutes (per instance).
**Why:** API.NSW's terms deny access after three consecutive failed
identifications. Without a backoff, every visitor's request would be
another failure, and a typo in an env var could lock the account.

### Token cache in module scope, per instance

> **Superseded in round 2: the token now lives in Blobs, because scheduled runs are cold starts.**

**Decision:** the OAuth token lives in module scope until five minutes before
expiry. Concurrent cold requests share one token call. An upstream 401
drops the token and retries once.
**Why:** tokens last ~12 h. Each warm instance fetches its own, which costs a
handful of calls a day. Expiry is our clock plus `expires_in`, so clock
differences between Netlify and API.NSW do not matter.
**Alternatives:** a shared token in Netlify Blobs. More moving parts to save
a few calls a day. Revisit only if token calls turn out to count heavily
against the quota.

### Upstream timestamps assumed to be Sydney time

> **Wrong. Live data showed UTC (round 2). See "Timestamps are UTC".**

**Decision:** `lastupdated` is parsed as Australia/Sydney wall-clock time and
served as ISO 8601 with its offset.
**Why:** the spec does not say, and Netlify runs in UTC, so a naive parse
would be 10–11 hours off. Sydney is the likeliest reading. To verify against
a live response. The assumption sits in one function.

### Zod for upstream responses, imported directly

**Decision:** the function validates upstream JSON with Zod (Patchbay's
choice) and imports `zod` directly.
**Why:** a changed upstream shape becomes a clean 502 instead of `undefined`
reaching the UI. Patchbay's `jitless` wrapper exists for a browser CSP that
does not apply on the server.

### netlify dev on Windows needs Developer Mode

**Decision:** keep pnpm's default isolated `node_modules`. Document that
`netlify dev` on Windows needs Developer Mode.
**Why:** Netlify bundles v2 functions with NFT, which ignores
`node_bundler`. NFT recreates pnpm's symlinks next to the function, and
Windows refuses symlinks without Developer Mode. The fix is a one-time
machine setting, and the repo keeps the same layout as Patchbay.
**Alternatives:** `nodeLinker: hoisted` in `pnpm-workspace.yaml`, which was
tested and works, but it allows undeclared dependencies to resolve
everywhere. Or dropping Zod from the function, which was rejected because
it trades a local-tooling problem for hand-written validators.

## 2026-10-21: Round 2 (live data, snapshot architecture)

### Scheduled snapshot replaces the per-request proxy

**Decision:** a scheduled function (`netlify/functions/snapshot`) fetches
statewide prices every 30 minutes into Netlify Blobs. `/api/nearby` and
`/api/location` answer from that snapshot and never call API.NSW. The
per-request client, its nearby/location calls and `/api/reference` were
deleted.
**Why:** with per-request calls, visitors spend the 2,500-a-month quota. A bot
or a traffic spike could exhaust it mid-month and break the demo exactly when
someone is looking at it. A snapshot makes the call count a constant set by
the schedule, whatever the traffic. It was only possible because live
`/prices` turned out to include every station's address and coordinates.
**Alternatives:** keep per-request with heavier CDN caching (still
traffic-dependent); `/prices/new` deltas (saves bandwidth, not calls, and its
cursor is per API key, so any manual run steals the scheduled run's changes).

### Every 30 minutes

**Decision:** cron `*/30 * * * *`.
**Why:** budget a 31-day month at 2,000 calls (2,500 less 20% headroom).

| Interval | Price calls | Token calls | Total  | Fits? |
| -------- | ----------- | ----------- | ------ | ----- |
| 15 min   | 2,976       | 62–93       | ~3,050 | no    |
| 20 min   | 2,232       | 62–93       | ~2,310 | no    |
| 30 min   | 1,488       | 62–93       | ~1,580 | yes   |

30 minutes is the most frequent schedule that fits, with 920 calls to spare
(37%). Live data puts 1,856 of 9,674 prices as changed in the last day, so a
price is typically hours old anyway; 30 minutes adds little.
**Alternatives:** hourly (~830 calls/month; more headroom, staler prices).
Skipping overnight runs (saves ~300 calls), rejected: it adds schedule logic
to save calls we do not need.

### Token and lockout state in Blobs

**Decision:** the OAuth token (`auth/token`) and the credential-failure count
(`auth/failure`) live in Blobs, read with strong consistency.
**Why:** each scheduled run is a cold start, so module scope would mean a token
call on every run, doubling the cost to ~3,000 calls/month. Verified locally:
the second run made 0 token calls and 1 price call.

### Lockout guard in Blobs

**Decision:**

- After the 1st credential rejection: no token call for an hour.
- After the 2nd: none at all with those credentials.

The count is keyed on a hash of the key and secret, so changing either
resets it, and a success clears it.
**Why:** API.NSW denies access after 3 consecutive failed identifications.
Run every 30 minutes, the old 5-minute backoff would have reached three
failures in an hour. With this guard, the code never makes the third attempt;
a human has to fix the credentials (or delete `auth/failure`) first.
**Alternatives:** exponential backoff with no cap (still eventually makes the
third attempt).

### /lovs not used

**Decision:** no reference-data call at all. Fuel names are static in
`shared/fuelTypes.ts` and bundled into the app.
**Why:** every station and brand we need is already in `/prices`. Only 9 fuel
names matter, and they have been stable since 2016. That saves a 715 kB call
and a code path.

### Fuel list from live data

**Decision:** U91, E10, P98, P95, DL, PDL, LPG, E85, B20, with FuelCheck's names.
**Why:**

- EV has 902 rows: 900 are 0 and two are from 2020–21, priced per kWh.
- 889 of the 3,286 "stations" are EV chargers with no fuel at all.
- LNG, H2 and CNG have no prices.
- The combined codes (E10-U91 etc.) are for FuelCheck's own search UI.

### Timestamps are UTC

**Decision:** `lastupdated` is parsed as UTC.
**Why:** verified. At 03:21 UTC the newest was 03:17:28, and the day's 415
updates fell between 00:00 and 03:17 (Sydney's late morning to early afternoon). The first round's
Sydney assumption would have put every price 11 hours in the future.

### Suburb and postcode search from station addresses

**Decision:**

- Suburbs and postcodes are resolved from the snapshot's own addresses.
- Same-name stations are grouped with a 40 km single-linkage threshold, and
  a postcode is placed at its largest group.
- Results are the place's stations plus any within the radius of its centre.
- A name that means two places returns 409 with `candidates`.

**Why:** measured on live data:

- the widest real single place spans 19.2 km (White Cliffs);
- the nearest different places sharing a name are 149 km apart (Cobar's
  roadhouse, which shares a label and is merged), then 303 km (Griffith
  NSW/ACT);
- postcodes are sometimes wrong in the data, so a postcode alone is not
  trusted.

**Known gap:** only suburbs with a fuel station (1,101) can be found. A
residential suburb like Bondi Beach is a 404. Proposed fix for Phase 1: a
bundled suburb/postcode centroid gazetteer (ABS Suburbs and Localities, CC
BY 4.0), used to locate the place before searching around it.

### Coordinate rounding, revisited

**Decision:** keep rounding nearby positions to 2 dp (~1.1 km), and search
0.8 km past the radius to make up for it.
**Why:** it no longer protects the quota. It still makes neighbours share CDN
entries, so a burst of identical requests runs the function about once a
minute. More importantly, the URL ends up in browser history, logs and
shared links, and should never carry an exact position. The client
recomputes exact distances from the station coordinates in every result.
**Alternatives:** drop rounding (exact server-side distances, but every URL
unique and precise).

### CDN TTL: one minute

**Decision:** prices are `max-age=60` in the browser and
`s-maxage=60, stale-while-revalidate=60, durable` at the edge (down from 5
minutes).
**Why:** answers cost no upstream calls now, so long TTLs buy nothing. A new
snapshot is visible within about 2 minutes of being written. The edge still
absorbs bursts.
**Alternatives:** a TTL computed to expire exactly at the next snapshot. More
precise, but more logic for at most a minute saved.

### Stale snapshot: served and flagged, not refused

**Decision:** a snapshot older than 90 minutes (3 missed runs) is still
served, with `stale: true`. No snapshot at all is a 503
`snapshot_unavailable` with `Retry-After: 60`.
**Why:** live data shows most prices are days old anyway (7,485 of 9,674 are
1–30 days old). A 3-hour-old snapshot is still the best answer anyone has,
and an error page would hide it. The UI shows "prices as of 2:30pm" from
`fetchedAt` and a notice when `stale`.
**Alternatives:** refuse past a threshold (an outage at API.NSW would take our
site down with it).

### History from launch: one blob per Sydney day

**Decision:** each run folds the snapshot into
`history/v1/YYYY-MM-DD` as `[min, max, last]` per station per fuel.
**Why:** API.NSW has no history endpoint. This costs no extra calls, and one
read and one write per run. It measured 262 kB a day (42 kB gzipped), about
95 MB a year. Days are Sydney days because that is what "Tuesday's price"
means to a NSW driver. The record misses a price that changes and changes back
between two runs; that is acceptable for a daily chart.
**Alternatives:**

- One blob per station: 2,400 writes a run.
- One per fuel per day: 9 writes a run.

  Both are worth revisiting if Phase 4 needs per-station reads; a compaction job
  can reshape the files then.

### Partial-response guard

**Decision:** a response with under half the previous snapshot's stations is
not written. The previous snapshot stays, and the failure is logged in
`meta/last-run`.
**Why:** a truncated upstream response would otherwise blank out half the
state until the next run.

### Phase 1: native `<select>` for fuel type

**Decision:** a native `<select>` with 9 options, not Radix Select.
**Why:**

- Phones show their own picker (wheel or sheet), which is the best touch UI
  there is for a short list.
- Screen readers and keyboards know a native select perfectly.
- It costs no JavaScript.
- Radix Select earns its place for custom option rendering and typeahead
  across long lists; neither applies here. In Patchbay it also needed a
  stylesheet workaround for its scroll lock under a strict CSP.

The closed control is styled with tokens; the open list is the OS's.

### Phase 1: no router; URL search params instead

**Decision:** no TanStack Router. A small `useSearchState` hook reads and
writes `URLSearchParams`:

- `pushState` when the search changes place;
- `replaceState` when only fuel or radius changes;
- it listens for `popstate`.

**Why:** the app is one screen whose state is its search (`?fuel=U91&q=2250`
or `?fuel=U91&lat=…&lng=…`). That state is shareable, survives reload, and Back
undoes a search, which is everything a router would give us here. A router
would add a plugin, generated route files and a dependency to model one
route. The playbook's rule is "every screen a user would link to is a
route", and a URL with search params satisfies it.
**Revisit if** Phase 4 adds a real second screen (a station detail page with
its own history chart).

### Phase 1: keep TanStack Query

**Decision:** server state through TanStack Query.
**Why:** this one, on its own merits, earns its place:

- requests are cancelled when the search changes;
- StrictMode double effects are de-duplicated;
- refetch on focus means a tab left open picks up the next snapshot;
- retries honour a 503 while the first snapshot is pending;
- Back is instant from cache.

Hand-rolling those is where small fetch hooks grow bugs.

## 2026-10-23: Round 3 (Phase 1 frontend, ABS gazetteer)

### Place search uses an ABS gazetteer

**Decision:** bundle 4,678 NSW and ACT suburbs and localities and 637
postcodes from the ABS (ASGS Edition 3, 2021, CC BY 4.0) into the API
function. Places resolve from this list first, and from station addresses
only as a fallback.
**Why:** station addresses only know the 1,101 suburbs with a fuel station, so
Bondi Beach, and most places people live, were "not found". The ABS service
returns centroids directly. Postcodes come from point-in-polygon against
postal areas and agree with station addresses for 98.5% of stations. The
ABS qualifier makes every label unique ("Kingswood (Penrith) NSW 2747"), so a
suggestion is also an unambiguous query.
**Alternatives:**

- Matthew Proctor's australian_postcodes CSV: popular, but mixes sources
  under unclear licence terms.
- G-NAF: authoritative, but gigabytes for a lookup that needs kilobytes.
- A geocoding API: a per-keystroke dependency, a key, and a quota.

### Combobox, not `<datalist>`, for suburb suggestions

**Decision:** a WAI-ARIA 1.2 combobox (Downshift `useCombobox`) fed by a
small `GET /api/places?query=` endpoint. It returns 8 suggestions, from 2
characters, debounced by 200 ms.
**Why:** accessibility is a hard requirement, and `<datalist>` cannot meet it
reliably:

- Its suggestion UI belongs to the browser and differs by engine. iOS Safari
  shows it as a QuickType bar above the keyboard, Android Chrome as a
  dropdown. Neither can be styled or tested.
- Screen reader support for datalist suggestions is known to be patchy
  across browser and screen reader pairs. That is from published support
  notes, not tested on devices here. Whether a changing list is announced is
  up to each pairing, and we could not add our own announcement.
- We cannot control its matching. Browsers mostly substring-match the option
  text, so "wagga" would not rank Wagga Wagga above The Gap (Wagga Wagga), and
  "mt druitt" would not find Mount Druitt.
- It needs all ~4,700 options in the DOM, or a fetch per keystroke that
  rewrites the `<datalist>` under the user. Some engines do not re-show the
  list after it changes.

The combobox gives us:

- a pattern screen readers know (`role="combobox"`, `aria-expanded`, and
  `aria-activedescendant` moved by the arrow keys);
- our own polite "8 suggestions" announcement;
- our own ranking, which matches exact name, then prefix, then a later word,
  then the qualifier, and ignores case, accents, full stops and "Mt"/"Mount";
- a list that is always eight short rows.

Free text still works: Enter with nothing highlighted searches what was
typed, so suggestions help but never block a search.
**Library behaviour found:**

- Downshift 9's hooks no longer announce result counts by default. Its
  `getA11yStatusMessage` does not re-run when async items arrive, hence our
  own status region.
- Downshift calls `preventDefault` on Enter whenever the menu is open, even
  with nothing highlighted, so a typed search never submitted. Fixed with
  Downshift's `preventDownshiftDefault` escape hatch. Both behaviours are
  covered by tests that fail without the fix.

**Alternatives:**

- React Aria's ComboBox: excellent accessibility, but several times the size.
- Hand-rolled: the playbook says not to hand-roll ARIA widgets.

### Screen reader announcements

**Decision:**

- One always-present, visually hidden `role="status"` in the results area
  announces progress and outcomes: "Finding your location…", "Loading
  prices…", "21 stations found. Cheapest Unleaded 91 is 229.5 cents a litre
  at …", plus "These prices may be out of date" when stale.
- Problems render as a `role="alert"` paragraph. Its action buttons sit
  outside the alert.
- No `aria-busy` on the results area.

**Why:**

- A live region must already exist when its text changes, or nothing is
  announced.
- Errors announced twice, once as a status and once as an alert, are noise.
- Some screen readers hold back live regions inside an `aria-busy` element,
  which would swallow the loading announcement itself.

### Focus never lands on `<body>`

**Decision:**

- Buttons that remove themselves when they work move focus first, in the
  same click:
  - Retry and Widen move it to the results heading (`tabIndex={-1}`);
  - a "did you mean" choice and "Search by suburb or postcode" move it to
    the suburb box.
- "Use my location" is not disabled while locating.
- Searching does not move focus at all.

**Why:**

- A removed or disabled focused element drops keyboard focus to the
  document, and the next Tab starts from the top.
- Moving focus synchronously in the handler follows the deferred-focus rule
  carried over from Patchbay.
- Not moving focus on search lets people refine what they typed.

### Design tokens in two layers

**Decision:**

- `--palette-*` primitives hold every colour value.
- Components use only semantic tokens (`--color-text`, `--color-accent`, ...).
- `src/styles/tokens.test.ts` fails if a CSS module writes a colour.
- It also checks every text/background pair against WCAG AA: 4.5:1 for
  text, 3:1 for the focus ring and control borders.

**Why:** Phase 3 dark mode then only re-points the semantic tokens under
`prefers-color-scheme: dark` and `[data-theme='dark']`, with no component
changes. jsdom cannot compute contrast, so axe's contrast rule is off in
tests and the token test covers it instead.

### Empty results offer "Search within 25 km"

**Decision:** when nothing sells the fuel within the radius, the empty state
offers one button that widens the radius to 25 km. The radius is stored in
the URL with `replaceState`.
**Why:** rural searches at the 5 km default often come back empty. Telling
someone "nothing here" without a next step is a dead end. This is an
empty-state action, not the Phase 4 distance filter: there is no radius
control otherwise.

### Postcode-only searches use the station cluster first

**Decision:** a postcode resolves to its largest cluster of stations where it
has any, and to the ABS postal-area centre otherwise.
**Why:** rural postal areas are huge. 2880's centre is far from Broken Hill,
where its stations are. Postcodes without stations (2026 Bondi) still
resolve through the ABS centre.

### Netlify credits: one deploy per round, docs-only pushes skipped

> **Corrected in round 3b: the team is on Legacy Free, where deploys cost build minutes, not credits. See "Correction: the team is on Legacy Free, not credits".**

**Decision:**

- Push once per round (all commits together).
- `netlify.toml` has an `ignore` command that skips builds when only
  `docs/` or Markdown changed.

**Why:**

- On Netlify's credit-based Free plan (accounts created on or after 4 Sep
  2025), each production deploy costs 15 of 300 monthly credits.
- Running out pauses every site on the team until the next cycle. Patchbay
  would go down with this site, if they share a team.
- Everything else this site does costs an estimated 50–90 credits a month:
  compute is billed at 1 GB for every function on Free, plus requests and
  bandwidth.
- So deploys are the only line item that can push the team over: at that
  baseline, 14–16 deploys a month is the ceiling.

**To check:** which plan model the team is on (Usage & billing > Plan).
Legacy Free charges nothing per deploy.

### History storage: no action needed yet

**Decision:** keep one Blobs file per Sydney day (~262 kB, ~95 MB a year).
Do not compact yet.
**Why:**

- Netlify publishes no separate Blobs storage limit or per-GB rate for Free.
  Its own page says Blobs draws from the credit pool without a published
  rate.
- Objects can be up to 5 GB, and a year of history is under 0.1 GB.
- Writes are one read and one write per run.

**If it becomes a problem** (a published rate, or Phase 4 needing
per-station reads), compact on the first run of each month: fold the
previous month's days into one gzipped `history/v1/YYYY-MM` file of
`[day, min, max]` per station per fuel. That is roughly 10× smaller, and it
also makes a station's month a single read.

### Whitespace in station names

**Decision:** collapse repeated whitespace in names and brands, as was already
done for addresses. Leave address casing as received.
**Why:** "Shell Reddy Express Erina" is plainly a typo. Title-casing
"MACKAY AV" would mangle names like McDonald and O'Connell, so there is no
safe automatic fix for case.

## 2026-10-23: Round 3b (snapshot stall)

### Snapshot stall: the API read Blobs through a stale edge

**What happened:** after the round 3 deploy (00:36 UTC), the API served the
00:30 snapshot until some time between 01:40 and 07:09, and again from 08:30
to at least 08:44.

**Evidence:**

- `netlify logs --function snapshot`: every scheduled run from 23:54 to 08:00
  logged `snapshot ok`, about 4 s and 1 API call each. 01:00, 01:30 and 02:00
  included. The job never stopped.
- `auth/token` was issued at 23:54:48 and never replaced, and there was no
  `auth/failure` blob, so no credential problem.
- Reproduced from 08:11 to 08:44. The API was polled every 10 s with
  cache-busting URLs, so the function ran each time (`Cache-Status:
fwd=miss`). `meta/last-run`, read through the CLI, showed the 08:30:34
  write. The API kept serving 08:00:37 for 13+ minutes.
- Before the deploy, with little traffic, new snapshots appeared within
  minutes. After an hour with no traffic, the 08:00 snapshot had been picked
  up.

**Cause:** the API re-checked the snapshot every 30 s with one conditional
`getWithMetadata(key, { etag })`, using Blobs' default eventual consistency.
That read is served by Netlify's edge cache. Under steady traffic, the edge
kept answering "unchanged" for the old etag far beyond the documented 60 s.
The deploy did not cause it. It only became visible once something polled
steadily (my checks).

**Fix:**

- Every API read of the snapshot is now strongly consistent, bypassing the
  edge cache:
  - a HEAD for the blob's metadata every 30 s;
  - the ~1 MB body only when the metadata's `fetchedAt` has changed.
- The version is `fetchedAt`, which the job writes into the metadata. It is
  not the etag, because the local Blobs server sends no etag on HEAD; an
  etag-based version reported "no snapshot" forever. Found locally, before
  deploying.
- `KeyValueStore` reads now take a required `consistency` argument, so every
  call site chooses.
- The in-memory store can model a stale edge (`staleEdge`). The regression
  test fails with eventual reads and passes with strong.

**Alternatives:**

- A strong full-body read every 30 s: simple, but 1 MB per check per
  instance.
- Shortening the check interval: does nothing against a stale edge.
- Having the job notify the API: functions cannot reach each other's
  memory.

### `GET /api/status`: a check you can look at

**Decision:** a no-store endpoint compares what the API is serving with the
latest run record, read strongly. It returns 200 when healthy, and 503 with
plain-English `problems` when:

- the last run failed;
- no run has happened for 90 minutes;
- the served snapshot is more than 90 minutes old;
- a newer snapshot was written over 5 minutes ago but an older one is still
  served (exactly this stall).

**Why:** the stall was silent. The job's log said "ok" while users got old
prices. A status URL can be opened in a browser or watched by a free uptime
monitor, which alerts on the 503.
**Alternatives:** logging only (nobody reads logs until something is
already wrong); the UI's `stale` flag (only after 90 minutes, and blind to
"newer exists but not served").

### Correction: the team is on Legacy Free, not credits

**Correction:** round 3 assumed the credit-based Free plan (15 credits a
deploy). The API says otherwise:

- `listAccountsForUser` shows the team was created on 2025-03-11, before the
  credit cut-over, with `credit_features: false`;
- the capabilities are the Legacy Free limits: 125,000 function invocations,
  100 GB bandwidth, 300 build minutes and 100 function GB-hours a month.

**What that changes:**

- Deploys cost build minutes, about 25 s each. 3 of 300 were used this month
  as of 2026-10-23.
- "Push once per round" stays a good habit but is no longer a credit rule.
- The `ignore` build command is still worth keeping.

**Risks that remain:**

- The 16 sites on the team, Patchbay included, share these limits.
- On Legacy, reaching 100% of a limit (other than build minutes) pauses all
  sites until you upgrade.
- Using a credit-only feature can move the team to credits, and Netlify says
  that switch is irreversible.
