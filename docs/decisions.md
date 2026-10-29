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
resets it, and a success clears it. (**Superseded in round 9**: that reset was
itself a path to the third failure. See "The lockout guard, rebuilt".)
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

> **Revisited in round 6 for the history view: still no router. See "No router: history= in the URL".**

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

> **Replaced in round 6 by the distance select. See "Distance steps".**

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

### Snapshot stall: an expired Blobs token in a warm API instance

**What happened:** after the round 3 deploy (live about 00:36 UTC), the API
served the 00:30 snapshot until some time between 01:40 and 07:09. It
happened again from 08:30 to at least 08:44, and again from 09:10 after the
round 3b deploy.

**Evidence:**

- `netlify logs --function snapshot`: every scheduled run from 23:54 on
  logged `snapshot ok` (about 4 s and 1 API call each), so the job never
  stopped. `auth/token` was never replaced, and there was no `auth/failure`,
  so it was not an API.NSW credential problem.
- Reproduced at 08:30 under 10-second cache-busted polling. `meta/last-run`
  showed the 08:30:34 write, while the API served 08:00:37 for 13+ minutes.
- After the first fix (strong reads, below) went live at 08:55, the 09:00
  snapshot reached the API within a second. Then from **09:10:51**, 15
  minutes after the instance started, every read failed. From
  `netlify logs --function api`:
  `BlobsInternalError: ... (Failed to decode token: Token expired)`.

**Cause:** `blobStore()` cached the `@netlify/blobs` Store for the life of a
warm instance. `getStore()` captures the current invocation's short-lived
Blobs token (`globalThis.netlifyBlobsContext`), and the store keeps it. About
15 minutes after a cold start the token expired:

- **Eventual reads** (until round 3b) did not fail. They went on returning
  the last cached copy, which is the silent stall.
- **Strong reads** failed loudly.

It only cleared when a quiet spell let Netlify replace the instance, which
is why low traffic hid it and steady polling exposed it.

**I first got this wrong.** I blamed the edge cache for keeping an
eventually-consistent read stale. Strong reads did not fix the problem; they
surfaced the real error, and the function log named it.

**Fix:**

- `getStore()` is called per operation (it only builds a client), so each
  read uses the current invocation's credentials.
  `netlify/lib/store.test.ts` mocks per-request expiring tokens and fails
  with the cached store.
- Kept from the first fix, still right on its own merits:
  - every API read of the snapshot is strongly consistent: a metadata HEAD
    every 30 s, and the ~1 MB body only when the metadata's `fetchedAt`
    changes;
  - `KeyValueStore` reads take a required `consistency` argument.
- The version is `fetchedAt`, not the etag: the local Blobs server sends no
  etag on HEAD, and an etag-based check reported "no snapshot" there.

**Alternatives:**

- Re-creating the store once per request, via request-scoped dependencies:
  equivalent, but more plumbing.
- Catching "Token expired" and retrying with a new store: treats the symptom.

### `GET /api/status`: a check you can look at

**Decision:** a no-store endpoint compares what the API is serving with the
latest run record, read strongly. It returns 200 when healthy, and 503 with
plain-English `problems` when:

- the last run failed;
- no run has happened for 90 minutes;
- the served snapshot is more than 90 minutes old;
- a newer snapshot was written over 5 minutes ago but an older one is still
  served (exactly this stall);
- the run record cannot be read: the error is shown, not "no runs". At
  09:10 the expired token first showed up as "No scheduled run has been
  recorded", which was misleading.

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

## 2026-10-24: Round 4 (round 3b close-out, Phase 2 map)

### Round 3b fix verified

**Evidence:**

- `netlify logs --function snapshot` from 09:50 UTC on the 23rd to 00:00 on
  the 24th: 29 scheduled runs, all landed. 28 logged `snapshot ok` first
  time.
- The 16:00 run got a `null` body from `/prices` after 10 s and failed
  cleanly (`bad_response`, previous snapshot kept). Netlify invoked the
  function again 4 s later, and that run succeeded. Cost: one extra call.
  Written up in api-notes.md, "Failure behaviour".
- `netlify logs --function api` over the same period: no errors. But traffic
  stopped at 09:59, 9 minutes after the deploy, so the 15-minute token
  expiry had not been tested under steady load.
- So it was tested on the 24th instead: `/api/status` polled every 10 s from
  00:15 to 00:46. All 177 polls were healthy. The 00:30:36 snapshot was
  served by the 00:30:44 poll. The API log shows one warm instance throughout
  (constant memory, no cold-start durations) and no errors, well past the
  15 minutes at which the old code failed.

### Map tiles: OpenFreeMap, drawn by MapLibre GL, not Leaflet

**Decision:** MapLibre GL JS 6.14 with OpenFreeMap's Positron style.
**Why:** Round 3's plan said Leaflet, but no raster tile provider fits the
brief any more:

| Provider        | Key / account                                          | Fits?                                                                                                                                            |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OSM's own tiles | none                                                   | No: the usage policy discourages app traffic and can block without notice                                                                        |
| CARTO basemaps  | **key now required**                                   | No: a keyless request returns an "API KEY REQUIRED" image (checked 2026-10-24). Free non-commercial up to 5M tiles a month, but needs an account |
| Stadia Maps     | account, with domain auth (no key in code)             | Possible, but needs you to sign up. Free plan: non-commercial, 200k credits a month                                                              |
| OpenFreeMap     | none: "no registration, no user database, no API keys" | **Yes.** No request limits, OSM data, Positron and Dark styles                                                                                   |

OpenFreeMap only serves vector tiles, and Leaflet cannot draw those without a
WebGL plugin. MapLibre draws them natively, and it brings two things this map
needs anyway:

- label collision, which makes dense prices readable (below);
- canvas-drawn markers, which stay fast with 560 stations.

**Cost:** MapLibre is ~431 kB gzipped (JS 277 kB, worker 143 kB, CSS 10.5 kB),
against ~45 kB for Leaflet. It is lazy-loaded, so the first page load grows
only 3.5 kB (JS 94.9 → 97.7 kB, CSS 2.2 → 2.9 kB gzipped). On a phone it
downloads only when Map is chosen.
**Attribution:** "OpenFreeMap © OpenMapTiles Data from OpenStreetMap", from
the style, shown uncollapsed in the map's corner (`compact: false`). The OSM
policy says attribution must not be hidden behind a toggle, and MapLibre
collapses it on maps under 640 px wide by default.
**Risk:** OpenFreeMap is a donation-funded project with no SLA. If it goes
down, the map shows its dots on a blank background, and the list is
unaffected. Switching to Stadia or CARTO is a change to one style URL plus a
key or a domain registration.
**Alternatives:** Leaflet with Stadia (smaller, but needs your account, and
Leaflet has no label collision); MapLibre with CARTO's vector style (needs a
key).

### Prices on the map, and no clustering

**Decision:** stations are canvas circles coloured by price band, with the
price beside each dot. Labels that would overlap are dropped, and the
cheaper station's label wins (`symbol-sort-key` = price). No clustering.
**Why:** a 25 km search around Parramatta (2150) returns 563 stations, and
Sydney CBD (2000) returns 430. Price pills as DOM markers would be an
unreadable pile. Clustering would hide the prices, which are what people
came for. With collision, every dot stays visible and the cheapest prices are
labelled. Zooming in reveals the rest, and the list has them all. Checked in
a browser at 2150/25 km: readable.

### Price colours relative to the results

> **Colours replaced in round 5 by a colour-blind-safe blue, grey and orange. See "Price colours: blue, grey, orange".**

**Decision:** cheapest third, middle third and dearest third of the stations
shown, as `--color-price-low/mid/high` tokens (green, amber, red). Ties share
a band. The map reads the tokens at runtime, because it draws on a canvas.
**Why:** "cheap" is a different number in Broken Hill and in Parramatta.
Each colour has 3:1 against the basemap's land and water
(`src/styles/tokens.test.ts`), and colour is never the only cue: the price is
beside the dot or in the list. Known limit: green and red look alike to the
most common colour blindness. The labels carry the information; a
colour-blind-safe palette is proposed for Phase 3.

### Keyboard path to the map: the list's "Show on map" buttons

**Decision:** markers are not focusable and not in the accessibility tree.
Each list item has a "Show on map" button, and that is the keyboard and
screen reader path. The map itself has one Tab stop (the canvas: arrow keys
pan, + and - zoom) plus two zoom buttons.
**Why:**

- 560 focusable markers would put 560 Tab stops before the map's controls,
  in an order that means nothing (map position, not price).
- A roving-focus group (one Tab stop, arrow keys between markers) was
  considered. Arrow keys on a map mean "pan" in every map widget, MapLibre's
  included. Moving between scattered dots by arrow key has no predictable
  order, so a screen reader user would hear prices in random order.
- The list already gives the same stations in the order that matters
  (cheapest first), with full details, as headings. The button adds one Tab
  stop per station, which also fixes round 3's results having no Tab stops.
- So the map is a visual view of the list, not a separate source of
  information. That meets WCAG 1.1.1: the canvas is named "Map of 30
  stations selling Unleaded 91. The list has the same stations."

**Picking a dot** (pointer and touch) selects the station, scrolls the list to
it and highlights it, without moving focus. The tap target is any point
within 12 px of the dot, at least 24 px across (WCAG 2.5.8).

### Focus never jumps or gets lost

**Decision:** each selection action is a pure function in
`src/features/map/selection.ts` that returns the URL change and a focus
target:

| Action                       | Wide screen                    | Phone                                                   |
| ---------------------------- | ------------------------------ | ------------------------------------------------------- |
| "Show on map" (list)         | focus stays on the button      | switches to Map, focus to the station's card heading    |
| Dot picked (map)             | focus untouched, list scrolls  | focus untouched, card appears                           |
| "Show in list" (card, phone) | n/a                            | switches to List, focus to that station's "Show on map" |
| Close (card)                 | focus to that station's button | focus to the Map switch button                          |
| List/Map switch              | n/a                            | focus stays on the switch                               |

**Why:** the rule from round 3 still holds: a control that disappears hands
focus to whatever now stands for the same thing. The move happens in a
`useLayoutEffect` after the URL change renders, so it lands in the same task
(the deferred-focus lint rule). Tested in `MapSync.test.tsx` and in a real
browser.

### Phone layout: a List/Map switch in the URL, using replaceState

**Decision:** below 60 rem, two toggle buttons (`aria-pressed`) in a labelled
group switch between list and map, and `view=map` is kept in the URL. The
hidden view stays mounted (`hidden`), so the list keeps its scroll position
and the map does not reload. `station=` is kept the same way. Both use
`replaceState`.
**Why:**

- Tabs (`role="tablist"`) promise arrow-key navigation and a tab panel,
  which is more than a two-way switch needs.
- `replaceState` keeps Back meaning "undo my search", as in round 3. Push was
  considered for the view, since a phone user may expect Back to leave the
  map. But flipping list and map, or looking at five stations, would fill
  the history with steps that are not searches.
- A new place clears `station`. A fuel change keeps it, so the same station
  stays selected if it sells the new fuel.

### Wide layout: side by side, map sticky, centred on what is visible

**Decision:** from 60 rem, the page widens to 80 rem. The list and the map sit
side by side, and the map sticks to the top while the list scrolls. The search
form, header and footer keep the 40 rem reading width.
**Found in the browser:** at the top of the page the map starts half way down
the window, so its true centre is at the bottom edge, and "Show on map"
panned the station out of sight. The pan now uses an `offset` to the centre
of the visible part. It uses `offset`, not `padding`, because MapLibre keeps
padding for every later camera move.
**Also found in the browser (by the smoke check failing one run in two):** the
card under the map appears in the same render as the selection, so the
map's container has already shrunk when the pan starts. MapLibre's
`ResizeObserver` only catches up a frame later, so the pan was worked out for
the old size and the station ended up off centre by half the card's height.
The map now calls `resize()` before panning.

### Library behaviour this relies on (MapLibre GL 6.14)

- **Worker location:** v6 resolves its worker from `import.meta.url`, which a
  bundler breaks. `setWorkerUrl()` with Vite's `?url` import of the
  self-contained `maplibre-gl-worker.mjs` fixes it.
- **Attribution** collapses to an (i) button on maps 640 px wide or less
  unless `compact: false`.
- **Canvas:** gets `tabindex="0"`, `role="region"` and `aria-label` from
  `locale['Map.Title']` (default "Map"). We set our own label and keep it
  current.
- **Keyboard handler:** arrows pan, +/- zoom, Shift+arrows rotate (disabled
  here, with all other rotation and pitch).
- **Resize:** a `ResizeObserver` on the container, so a map un-hidden on a
  phone redraws itself. It runs a frame after the layout change, so a camera
  move in the same render as a size change calls `resize()` first. On resize
  the centre stays put.
- **`setData()`** returns a promise in v6; we do not need to wait for it.
- **Symbol placement:** labels in higher layers are placed first, and within
  a layer a lower `symbol-sort-key` wins. That is why the selected price
  always shows.
- **Without WebGL** the constructor throws. `MapErrorBoundary` catches that,
  or a failed chunk download, and says the list has every station.
- **`easeTo({ padding })`** persists on the camera. We use `offset`.

### Testing the map

- **Unit:** `selection.ts` (focus and URL rules), `mapData.ts` (bands,
  GeoJSON, bounds), and the URL state.
- **Component:** `StationMap.test.tsx` replaces MapLibre with a recorder. It
  checks the style URL, uncollapsed attribution, layer order, picking the
  nearest dot within 12 px, panning only for list selections, re-panning on a
  repeated "Show on map", not refitting on a data refresh, reduced motion,
  and the visible-centre offset.
- **Integration and axe:** `MapSync.test.tsx` runs the whole app with the map
  module replaced, on a phone and a wide screen. It checks that the map
  module is imported only when shown, every focus rule above, and axe in
  both layouts.
- **Real browser:** `pnpm check:browser [url]` (Playwright Chromium, as in
  Patchbay; not in CI, because it needs a running site). It covers postcode
  and suburb search, list to map, map to list, card close, a 375 px phone
  layout, MapLibre not downloaded for the list, and no console errors.

## 2026-10-24: Round 5 (Phase 3 polish)

### Dark mode: the device's setting, a remembered override, no flash

**Decision:**

- `tokens.css` has a second block, `:root[data-theme='dark']`, that re-points
  every semantic colour. `tokens.test.ts` fails if it misses one, and checks
  every contrast pair in both themes.
- A small inline script in `index.html` sets `data-theme` before the
  stylesheet applies: the stored choice, or the device setting. The app
  (`src/features/theme`) keeps it current afterwards, including when the
  device switches while the page is open, and across tabs (`storage` event).
- A native select in the header: "Match device", "Light", "Dark". Stored in
  `localStorage` (`fuel-finder:theme:v1`); every read and write is in a
  `try`, and a throwing or junk value means "match device".
- The map uses OpenFreeMap's Dark style in dark mode, and swaps style when
  the theme changes.

**Why:**

- The attribute is always set, so CSS needs only one dark block, not one
  under `prefers-color-scheme` and another for the override.
- A select, not a toggle: a toggle has no way back to "follow the device"
  once pressed.
- Verified in Chromium with the app's scripts blocked (`pnpm check:a11y`):
  the first paint is already the right theme in all four combinations of
  device setting and stored choice.

**Library behaviour this relies on (MapLibre 6.14):** `setStyle(url)` diffs
by default, and a diff between two OpenFreeMap styles drops our own layers
and fires no `style.load` to add them back. So it is
`setStyle(url, { diff: false })`, and our layers are added on every
`style.load` (the first style included) rather than once on `load`.

### Price colours: blue, grey, orange

**Decision:** the price bands are blue (cheapest third), grey (middle) and
orange (dearest third), in both themes. `tokens.test.ts` simulates
protanopia, deuteranopia and tritanopia (Machado et al. 2009) and requires
every pair of bands to stay at least ΔE 20 apart; each band also needs 3:1
against the basemap's land, water and parks in both themes.
**Why:** the old green/amber/red measured ΔE 5.8 between amber and red with
deuteranopia, the most common colour blindness: practically one colour. Blue
and orange is the one hue pair that survives all three; grey sits between
them in lightness as well as hue. The new palette measures ΔE 23 or more in
every case.
**Not by colour alone:** the cheapest stations say "Cheapest" in words, in
the list (a badge) and on the map ("Cheapest 209.9", whose label wins any
collision). Not when every price is the same. The search centre moved from a
blue ring, which would now read as a cheap station, to a ring around a dot:
told apart by shape.

### Long lists: 20 at a time

**Decision:** the list shows the cheapest 20, with "Show 20 more" and a
polite "Showing 40 of 561 stations" status under it. "Show more" moves focus
to the first new station's heading. The status region's summary says
"Listing the cheapest 20". A new search starts from 20 again; a refresh of the
same search does not. A station picked on the map beyond the batch is listed,
with everything cheaper, and stays listed after Close so focus can return to
its button. The map still shows every station.
**Why:** a 25 km search around 2150 returns 561 stations, which was 561 Tab
stops before the footer. Twenty is a screen or two on a phone and more than
anyone compares.
**Alternatives:** virtualising the list (keeps the Tab stops, breaks find in
page and screen-reader list navigation); "Show all" (one press back to 561
Tab stops).

### Default radius stays 5 km, with a wider search offered sooner

**Measured** on 24 Oct across all 637 NSW and ACT postcodes, Unleaded 91:

| Radius | Empty | Under 3 stations | Median | Over 50 |
| ------ | ----- | ---------------- | ------ | ------- |
| 5 km   | 70    | 231              | 6      | 28      |
| 10 km  | 44    | 167              | 13     | 192     |
| 25 km  | 19    | 93               | 60     | 327     |

**Decision:** keep 5 km. When a search finds only one or two stations, offer
"Search within 25 km" beside them, as the empty state already did.
**Why:** 10 km would halve the empty rural results but turn 192 postcodes,
mostly in Sydney, Newcastle and Wollongong, into lists of over 50 stations,
most of them further than anyone drives for fuel. The people 5 km fails are
in the country, and one button reaches them. A real distance filter is
Phase 4.

### Old prices: flagged at 14 days

**Decision:** a price not updated for 14 days or more reads "Price not
updated for 32 days", in bold, in the warning colour.
**Why:** measured across the same 637 searches: 6.7% of prices shown were
over 7 days old, 1.9% over 14 and 0.5% over 30. NSW stations must report a
change within 30 minutes, so an old price is usually just unchanged, but a
fortnight is unusual. At 7 days one station in fifteen would be flagged and
the flag would stop meaning anything.

### Smaller fixes

- **"which place?"** is a question, not an error: accent-coloured, said once
  by the polite results status, no longer `role="alert"`.
- **"within 5 km of postcode 2880"**: a four-digit origin label (a postcode
  searched on its own) gets the word.
- **Loading:** grey station-shaped cards while prices load (hidden from
  screen readers, which hear "Loading prices…"), and "Loading map…" over the
  map until its first complete render, or "The map couldn't load" if MapLibre
  reports an error first. Reduced motion stops the pulse; `global.css` also
  sets `animation-iteration-count: 1` there, since an infinite animation cut
  to 0.01 ms flickers.
- **Silent refreshes:** when coming back to the tab brings a newer snapshot
  for the same search, the status region says "Prices updated, as of 3:00 pm"
  before the usual summary (`useRefreshed`). A new search's first answer is
  not announced as an update.
- **Escape in the suburb box:** kept as it was. The first Escape closes the
  suggestions and keeps the text; a second clears it. That is the WAI-ARIA
  combobox pattern and what a native search box does, and the text survives
  the press people make to get the list out of the way. Now covered by a test.
- **Netlify's badge:** the free plan injects a "Powered by Netlify" iframe,
  fixed bottom-right, 181 by 48 px, with no way to hide it on this plan
  (its script ignores a stored dismissal when `data-account-tier="free"`). It
  is the last Tab stop and never takes focus. The page now ends with 4rem of
  clearance and the sticky wide-screen map stops 4rem short of the bottom, so
  neither the page's last line nor the map's attribution sits under it.
  `pnpm check:browser` checks both against production.
- **Phone Back:** unchanged. Back still undoes the last search, and list/map
  and the selected station still use `replaceState`. Nothing found this round
  argues for a change; waiting on the phone tests.

### The map's first load

**Measured** (Chromium, 390 px phone, 4× CPU slowdown, 9 Mbps): the map's
own load is a chain: the 282 kB (gzipped) MapLibre chunk, then its 141 kB
worker, then the style, then the tile index the style names, then tiles and
fonts. Before this round the canvas sat blank for most of that.

**Decision:**

- "Loading map…" covers the canvas until MapLibre's `load` event.
- While the chunk downloads, `warmMapResources()` fetches the worker, the
  style, the tile index and the 0-255 range of every font the style uses.
  All are public and cacheable (OpenFreeMap sends `Cache-Control: public,
max-age`), so MapLibre's own requests are answered from the cache. Traced:
  style, tile index and fonts came from cache.
- `<link rel="preconnect">` to tiles.openfreemap.org.
- `/assets/*` is served `Cache-Control: public, max-age=31536000, immutable`.
  Vite hashes every asset name, so a returning visitor no longer revalidates
  the 1.5 MB of map code (Netlify's default is `max-age=0, must-revalidate`).
  `index.html` keeps the default, so deploys are seen at once.

**Result, honestly:** at 150 ms latency the warm-up made no measurable
difference (2.6-3.1 s with, 2.6-2.8 s without). At 300 ms, closer to a weak
4G signal, it cut the first complete map from 3.6-3.8 s to 3.1-3.3 s. The
local server sent `no-cache` for the worker, so production, with the
immutable header, should do a little better. The ~8 s seen on a real phone
was not reproduced here; the placeholder means it is no longer blank either
way. To confirm on a phone.

### Bundle budget

**Decision:** `pnpm bundle:check` (`scripts/check-bundle-budget.js`, adapted
from Patchbay's), in CI after the build. Raw sizes, kB of 1,024 bytes:

| Payload            | Now     | Budget |
| ------------------ | ------- | ------ |
| Initial JS         | 316.7   | 332    |
| Initial CSS        | 15.6    | 18     |
| Largest lazy chunk | 1,016.0 | 1,100  |
| MapLibre worker    | 496.4   | 540    |

The initial budgets hold the first load near where it is (5% headroom); the
map has its own ceilings because "lazy" is not "free" on a phone. Round 4's
initial JS was 311.2 kB; this round added 5.5 kB (dark mode, the batches).

### Testing this round

- **Unit and integration:** tokens in both themes and under colour
  blindness; the first-paint script run as index.html's own text; the theme
  select, storage failures and another tab's change; map style swaps,
  the loading overlay and the warm-up; batches, focus after "Show more", the
  selected station beyond a batch; the badge, old prices, postcode wording,
  the short-list offer, refresh announcements, Escape; axe in both themes.
- **Real browser:** `pnpm check:browser` gained the map placeholder, dark
  basemap, "Show more" and the Netlify badge checks. New `pnpm check:a11y`
  runs axe with its contrast rule on (which jsdom cannot) in both themes, the
  no-flash first paint, and every width (320, 375, landscape phone, tablet,
  desktop) for sideways scrolling, with screenshots to look over.
- **Screen readers:** checked through Chromium's accessibility tree. Not
  checked with NVDA, VoiceOver or TalkBack in this round.

## 2026-10-24: Round 6 (Phase 4 extras)

### Distance steps: 2, 5, 10 and 25 km, default 5

**Measured** on 24 Oct across all 637 NSW and ACT postcodes, Unleaded 91,
counting stations within each distance of the place:

| Radius | Empty | Under 3 | Median | Over 50 |
| ------ | ----- | ------- | ------ | ------- |
| 2 km   | 132   | 349     | 2      | 0       |
| 3 km   | 105   | 283     | 3      | 0       |
| 5 km   | 70    | 231     | 6      | 28      |
| 10 km  | 44    | 167     | 13     | 191     |
| 15 km  | 40    | 140     | 23     | 250     |
| 25 km  | 19    | 93      | 60     | 327     |

**Decision:** a native `<select>` labelled "Within", beside Fuel, offering
2, 5, 10 and 25 km, kept in the URL with `replaceState` (like fuel, it adjusts a
search rather than starting one). Default stays 5 km. It replaces the "Search
within 25 km" buttons; an empty result now says so and offers "Choose a larger
distance", which moves focus to the select.
**Why these steps:** 2 km is for a city centre, where 5 km can mean 60
stations; it is empty for a fifth of postcodes, so it is not the default. 10
and 25 are for the country. 15 km was left out: it finds barely fewer empty
results than 10 (40 postcodes against 44) while doubling the median list. A
URL radius that is not a step (an old link with `radius=7`) becomes the next
step up, so it still covers what was asked.
**Why a select:** four real choices, a picker every phone already has, and
the same pattern as Fuel. A slider would have offered 25 positions of which
four are useful, and is fiddly with a thumb and with arrow keys.

### Favourites: on this device, priced through `/api/stations`

**Decision:**

- Saved in `localStorage` (`fuel-finder:favourites:v1`) as `{ code, name }`, at
  most 50, with the theme's pattern: every access in a `try`, junk ignored,
  another tab's change picked up through the `storage` event.
- A new `GET /api/stations?codes=…` answers from the snapshot the API already
  holds: every fuel each station sells, plus the codes it no longer lists.
  Codes are sorted, so the same favourites share one edge cache entry.
- A "Favourites" panel (a native `<details>`) above the results, cheapest
  first for the chosen fuel. It is open when there is no search and closed
  once there is one, so it never pushes results down on a phone.
- The star is a toggle button named "Favourite, Metro Gosford", with
  `aria-pressed` for the state.

**Why an endpoint:** the search results only hold stations near the current
search, and favourites can be anywhere. Searching around each one would be a
request per favourite. Looking stations up by code in the snapshot already in
memory is one cached request and no API.NSW call.
**Why that name, not "Add Metro Gosford to favourites":** a toggle's name
must stay the same while `aria-pressed` carries the state. "Add … to
favourites, pressed" reads as the opposite of what is true. The visible word
is "Favourite", so the name also contains the label (WCAG 2.5.3).
**Gone stations:** stored with their name, so "FuelCheck no longer lists this
station" can still say which one, with Remove beside it. Removing moves focus to
the next row's Remove, or the panel's summary.

### Price history before our own: FuelCheck's monthly files

**Evaluated:**

- **Format.** One file a month on data.nsw.gov.au (dataset `fuel-check`), as
  XLSX or CSV depending on the month, 3-17 MB, about 150,000 rows. Columns:
  station name, address, suburb, postcode, brand, fuel, time, price. **One row
  per price change, not per day.** The newest file is September 2026,
  published 14 Oct; October will appear in early November.
- **Time zone.** Sydney wall-clock. A change our snapshot recorded at
  04:40:07 UTC on 17 Sep is 14:40:07 in the file. XLSX stores Excel serial days,
  and CSV stores "2026-03-01 00:05:26".
- **Matching.** The files have no station code. Matched to our snapshot's
  stations by normalised address, then by name within the postcode; anything
  ambiguous is left out rather than guessed. July to September 2026: 2,490 of
  2,529 stations and **99.2% of changes** matched. The rest are mostly stations
  since closed or renamed.
- **Licence.** CC BY-SA, version not stated on the portal. Obligations: credit
  the source (title, author, link, licence), say it was changed, and share
  adaptations under the same licence. Our daily low/high/last is an
  adaptation, and showing it on a public site is sharing it. So the history
  view and the site footer credit "NSW FuelCheck price history (NSW Fair
  Trading)" with links, say we worked out the daily figures, and license them
  under CC BY-SA 4.0. `/api/history` carries the same line in a `licence`
  field. The app's code stays MIT; the licence covers the data.

**Decision:** backfill the last three published months (1 Jul to 30 Sep 2026) with `pnpm history:backfill` (`scripts/build-history-backfill.mjs`):

- it finds the files through the CKAN API by name, so it is reproducible and
  rerunnable when the next month appears;
- it reads the month before the window too, only for the price each station
  opened on;
- each day's row is [low, high, last], counting the price in force at
  midnight, so a quiet day still has a row;
- `--upload` writes one file per station to `history/v2/backfill/{code}` in
  Blobs (done for 2,393 stations: about 14 kB each, 1 min 44 s, no API.NSW
  calls).

The parsing is in `scripts/lib/fuelcheck-history.mjs`, tested from
`netlify/lib/history/backfill.test.ts` against the schema the API reads. XLSX
is unzipped with fflate, a small dependency-free dev dependency; the sheet XML
is read directly.
**Known gap:** 1 to 22 October has no data until FuelCheck publishes October.
The chart shades it "No data" and the text names the dates. Rerunning the
script then fills it.

### History storage: per-station files, folded a slice at a time

**Decision:** the chart reads two small files per station:
`history/v2/backfill/{code}` (published, written once) and
`history/v2/live/{code}` (ours). Each scheduled run folds finished days from
our existing daily files (`history/v1/DAY`) into the next 200 stations' live
files, tracking progress in `history/v2/progress`. With about 2,400 stations
and a run every 30 minutes, every station has yesterday by around 6 am Sydney
time. Later runs find nothing to do for one small read. `/api/history` reads
the two files (eventual consistency: they change once a day), takes the last
120 days, and joins them, with the published history winning for any day
both have (it has every change; ours has what a 30-minute snapshot saw).
**Why not a monthly roll-up:** one file per month holds every station.
Reading three or four months for one chart is megabytes, not kilobytes.
**Why slices:** folding all 2,400 stations in one run is about 4,800 Blobs
operations inside a scheduled function's 30-second limit, on the run that also
fetches prices. A slice is about 400, 16 at a time. The fold runs after the
snapshot is safely written and can never fail the run. A missed slice is
picked up next time, and a station that fell behind catches up at most 14
days at once.
**Why two files, not one:** the job and the backfill script never write the
same key, so neither can overwrite the other. The CC BY-SA data also stays
visibly separate from ours.
**Deployment reality:** Netlify re-invokes a failed scheduled run, so two runs
can overlap. Both would read the same progress and write the same rows for the
same slice: the fold is idempotent, so the worst case is the work done twice.

### The chart: hand-drawn SVG, a slider for the keyboard

**Decision:** a 2px line for each day's last price over a light band from
low to high, in the accent colour, drawn as SVG at the container's real
width. Gaps break the line and are shaded "No data". Around it:

- a sentence first: "Lowest in the last 116 days: 157.9 cents a litre on Wed,
  1 July. Highest: 246.9 on Tue, 22 Sept.";
- where each stretch came from, and which days are missing;
- every day in a `<table>` inside a closed `<details>`.

With fewer than three days the chart is left out and the words and table carry
it. The crosshair follows the pointer and the arrow keys, and it shows only
while the chart is in use: parked on the last day it read as an extra axis
line. Lazy-loaded: 8.4 kB raw, 3.3 kB gzipped, budget 16 kB.
**Why `role="slider"`:** moving a crosshair a day at a time with the arrow
keys, Home and End is a slider, and screen readers already know how to say
one. Its `aria-valuetext` is the day's prices ("Sat, 24 Oct: last 241.9, low
241.9, high 241.9 cents a litre"), so the visible readout below is not a live
region as well. A focusable `role="group"` with key handlers was tried first,
and the jsx-a11y lint rules rightly refused it.
**Why no chart library:** one series and a band. The libraries considered
(Recharts, Chart.js, uPlot) are 45-100 kB gzipped for what is about 200
lines of SVG here, and they would need their own accessibility work anyway.

### No router: `history=` in the URL

**Decision:** a station's history opens over the results from a link on its
name (in the list, the map's card and the favourites), at
`?…&history=972`. It is pushed, so Back closes it, while every other change
on the screen still replaces. The results and the map stay mounted
underneath, hidden, so closing returns to the same scroll position and the
same map. "Back to results" goes Back when this page opened the view, and
replaces when it came from a shared link. Focus goes to the view's heading on
opening, and back to the station's link on closing.
**Why no router:** this is the "revisit if Phase 4 adds a real second screen"
from Phase 1. The history view is linkable, shareable and reached with Back,
which is everything a router would give. It is still one search screen with
one overlay, so a router would add a dependency and route files for one URL
parameter.
**Found in the browser:** the favourites panel links to the same station, and
focus was returned to that copy, inside the closed `<details>`, where it
cannot be focused. jsdom has no layout and passed. Links in a closed
`<details>` are now skipped, and a test that fails without the fix covers it.
**Station links:** the link's name is the station's own, because it sits in
the station's heading and anything added would be read as part of every
heading. Its destination is a shared `aria-describedby`: "Metro Gosford,
link, opens its price history".

### Bundle sizes, round 6

| Payload            | Round 5 | Round 6 | Budget |
| ------------------ | ------- | ------- | ------ |
| Initial JS         | 316.7   | 324.2   | 332    |
| Initial CSS        | 15.6    | 17.1    | 18     |
| History view chunk | n/a     | 8.4     | 16     |
| Map chunk          | 1,016.0 | 1,015.9 | 1,100  |
| MapLibre worker    | 496.4   | 496.4   | 540    |

The initial bundle grew 7.5 kB: the distance select, favourites, the history
link and the lazy wrapper. It is still inside the round 5 budget, which was not
raised.

## 2026-10-24: Round 7 (launch readiness)

### Security headers

**Decision:** in `netlify.toml`, on every response: a Content-Security-Policy,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
allowing geolocation for this origin only, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`. The
policy, directive by directive, is commented in `netlify.toml`. In short:

- **Scripts** from this origin, plus two inline scripts by SHA-256 hash: the
  first-paint theme script, and the script inside Netlify's free-plan badge.
  Never `'unsafe-inline'` or `'unsafe-eval'`.
- **Inline styles are allowed.** Measured, not assumed: the badge draws itself
  in a `srcdoc` iframe, which inherits this policy, and its stylesheet starts
  `:root{--nl-vw:${innerWidth}px;--nl-vh:${innerHeight}px}`. Its hash was
  different at 375 and 1280 px wide, so no list of hashes can cover it.
  Refusing it would not just restyle the badge: its own script sizes the
  visible box, so the badge would silently vanish, and on the free plan it is
  meant to show. The app itself needs no inline styles (React and MapLibre
  style through the CSSOM, which CSP does not govern). Inline CSS cannot run
  code; script stays locked.
- **The map:** `connect-src` and `img-src` add `https://tiles.openfreemap.org`
  only. `worker-src 'self'` is enough. MapLibre only builds `blob:` workers
  for a cross-origin worker URL, and ours is our own hashed asset
  (`setWorkerUrl`). Its `eval` is for RTL-text and custom-protocol plugins,
  which we do not load.
- **`frame-ancestors 'none'`**, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `upgrade-insecure-requests`.

**Referrer-Policy** sends other sites (OpenFreeMap, the credited sources) our
origin and never the page URL, whose query holds a search or a rounded
position.

**Verified before production** with `pnpm serve:headers`. It serves the build
with these exact headers, proxies `/api` and the badge loader to production,
and adds the badge tag as Netlify does. Under it:

- the smoke check (map, tiles, dot picking, dark basemap, history, phone map)
  passed with zero violations;
- the badge drew;
- MapLibre's worker loaded from our origin;
- an inline script injected as a negative control was refused.

`check:browser` now fails on any `securitypolicyviolation`, and on a badge
that does not draw. `netlify/lib/securityHeaders.test.ts` fails when the theme
script's hash goes stale or the script policy loosens.
(**Superseded in round 9**: Netlify no longer serves the badge, so its hash
and `'unsafe-inline'` styles are gone. See "Content-Security-Policy,
tightened".)
**Known fragility:** when Netlify changes its badge, its script hash changes
and the badge stops drawing. The smoke check reports it, and the fix is the new
hash from the violation message. The owner's toolbar (shown to a logged-in
site owner) has a different script and is not allowed. It is a Netlify
convenience for us only.
**Alternatives:** `'unsafe-inline'` for scripts (no protection against
injection at all); a nonce (needs a server rendering each page, and Netlify
serves this one statically).

### Domain-aware, so a custom domain is a setting

**Decision:** the canonical link and the Open Graph URLs are filled in at
build from Netlify's `URL` variable, which is the site's primary domain.
Moving to `fuel.calvinrdevelopment.com` is a Netlify domain setting plus a
redeploy, with no code change. `SITE_URL` overrides it.

### Screenshots, reproducibly

**Decision:** `pnpm screenshots` serves the real build locally and answers
`/api/*` from fixtures recorded from production (`--record`; reads only). It
fixes the clock a few minutes after the recorded snapshot, so "updated 2 hours
ago" never drifts, and waits for the map's first complete render. Captures:
light and dark, 1280 px and 390 px (at 2×), for results with the map, price
history and favourites. The same run composes the Open Graph card
(`public/og-image.png`, 1200×630) and a hero image (`docs/screenshots/hero.png`).
Only the map tiles are live, so a re-run after OpenFreeMap updates its tiles
can differ in the basemap alone.

### Maintenance reminder

> **Early November 2026:** run `pnpm history:backfill --months 4 --upload` once
> FuelCheck publishes October, to fill the 1-22 October gap. It writes to
> production Blobs, so ask first. Also in the README's Maintenance section.

## 2026-10-24: Round 8 (UX enhancements)

### Triage

**Measured** from production's 07:00 UTC snapshot on 24 Oct (2,398 stations,
2,050 selling Unleaded 91) and the day file for 23 Oct, across all 637
postcodes and 4,678 suburbs and localities. Read only; no API.NSW calls.

| Distance | Empty postcodes | Median list | Largest list | Brands (median / max) |
| -------- | --------------- | ----------- | ------------ | --------------------- |
| 5 km     | 239             | 2           | 68           | 2 / 17                |
| 10 km    | 152             | 10          | 196          | 6 / 24                |
| 25 km    | 39              | 52          | 577          | 12 / 33               |
| 50 km    | 7               | 115         | 754          | 18 / 38               |

(Measured from each postcode's centre only, so more come back empty than in
the app, which also counts stations whose address is in the postcode.)

- 555 localities have no station within 25 km; for them the nearest is a
  median 33 km away and the tenth nearest 57 km.
- Since yesterday's last price, 234 of 2,047 Unleaded 91 stations (11%) have
  changed: 54 up, 180 down. Median change 2.0 cents, 90th percentile 5.0.
  Diesel, E10 and Premium 98 are similar.
- A station sells a median of 4 fuels, at most 7.
- 265 of 2,050 Unleaded 91 prices (13%) have not changed for 14 days or more.

| Candidate                                  | Call               | Why                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clear (×) button in the suburb box         | Build              | Escape already clears, but nobody on a phone knows that. Small, and returns focus to the box.                                                                                                                                                                                                                                                                                              |
| 50 km distance step                        | **Skip**           | In Sydney it is 698 to 754 stations (2000, 2150, 2170): a ~190 kB answer and 750 dots for a distance nobody in a city drives. The people 25 km fails are served better by the nearest-stations fallback below, which reaches 100 km without adding a step everyone sees. And 50 km each way to save 10 cents a litre on 50 L ($5) costs more in fuel than it saves.                        |
| Nearest stations when a search finds none  | Build              | 555 localities find nothing at 25 km, and the old answer was a dead end. The nearest 10, up to 100 km, in distance order, says where fuel actually is. A separate `nearest` field, so a page still running the old code shows its old empty state, never far stations as "within 5 km".                                                                                                    |
| Recent searches                            | **Later**          | The only place that does not clutter the form is inside the suburb box's suggestion list, which means changing a combobox whose keyboard and screen-reader behaviour is tested and still waiting on the phone tests; opening a list on focus is also a pattern many screen-reader users find noisy. Favourites and shareable URLs already cover "my usual". Revisit after the phone tests. |
| Summary strip (cheapest, average, saving)  | Build              | A fixed 50 L fill, said in the sentence. A tank-size control would be one more field for a number that only scales the saving.                                                                                                                                                                                                                                                             |
| Price change since yesterday               | Build              | 11% of stations change on a given day, by 2 to 5 cents, so it is shown only where it changed. Worked out by `/api` from yesterday's day file, which it already keeps: one ~260 kB Blobs read per warm instance per day, no API.NSW calls.                                                                                                                                                  |
| Sort: cheapest or nearest                  | Build              | Cheap, client-side, kept in the URL.                                                                                                                                                                                                                                                                                                                                                       |
| Brand filter, and hide prices 14+ days old | Build              | 12 brands is the median at 25 km, 33 the most, so it needs counts and must stay out of the way: a closed "Filters" disclosure. Brands as FuelCheck names them: "Ampol", "Ampol Foodary" and "EG Ampol" are different operators with different apps and cards, and grouping them would be a guess. 13% of prices are 14+ days old, so the old-price filter is worth a checkbox.             |
| Directions link                            | Build              | Apple Maps on Apple devices, Google's universal directions URL elsewhere (it opens the Google Maps app where installed). Coordinates, not the address, so it cannot geocode to the wrong place.                                                                                                                                                                                            |
| Every fuel the station sells               | Build              | `/api/history` already returns the station with every fuel, so it goes in the history view, which is already the station's own page. No new call of any kind.                                                                                                                                                                                                                              |
| Search controls that stay visible          | Build, ≥90rem only | From 1440 px the form moves to a sticky column of its own, beside the list and map, so it never competes with the sticky map. Between 960 and 1440 px it stays where it is: a sticky ~300 px form above the sticky map would leave the map a slit on a 768 px-tall laptop.                                                                                                                 |
| Very wide screens                          | Build              | The same change: from 1440 px the page grows to 112rem with the form beside the results; the list column keeps a readable measure and the map takes the rest.                                                                                                                                                                                                                              |
| Motion                                     | Build              | Only what explains a change: cards fading up into place, sort and filter changes animating the reorder (View Transitions, where supported), a pop on the favourite star. Transform and opacity only, never from invisible, all off under reduced motion.                                                                                                                                   |

### Nearest stations when a search finds none

**Decision:** when nothing within the distance sells the fuel, `/api/nearby`
and `/api/location` also send `nearest`: the 10 nearest that do, up to 100
km, nearest first. The page heads them "Nearest stations, 73–88 km away" and
says why before the list: "None sell Unleaded 91 within 25 km of Mount Hope
NSW 2877, so these are the nearest 4 that do, nearest first." No sort,
filters or saving sum: ten far-flung stations do not need them. Only when
nothing is within 100 km is it a dead end, which says so and suggests another
fuel; "Choose a larger distance" is gone, since every distance is now covered.
**Why a separate field:** a page still running the old code (an open tab
over a deploy) ignores it and shows its old empty state, rather than listing
stations 70 km away as "within 25 km".
**Why 100 km:** beyond it a list helps nobody. Lord Howe Island is 580 km
from the nearest station.
**Nearby searches:** the API only has the position rounded to ~1 km and
searches 0.8 km past the radius to make up for it. If everything it found is
really just outside the radius, those are the nearest, measured again from
the precise position; otherwise the API's own `nearest`, measured again.

### Change since yesterday

**Decision:** each station's price says how far it has moved today:
"↓ 2.0 today" under the price, in the list and on the map's card. Nothing
when it has not moved, which is most stations on most days, so the movers
stand out. Screen readers hear "down 2.0 cents a litre since yesterday"; the
arrow is hidden from them. Cheaper is in the accent colour, dearer in the
warning colour, but the arrow and the words carry it without colour.
**Where it comes from:** `/api` compares the snapshot with yesterday's last
price in our own day file (`history/v1/DAY`, Sydney day). Each warm instance
reads that file once a day (about 260 kB, eventual consistency, since a
finished day never changes) and keeps it. A failed or missing read leaves
every change unknown (`null`), is retried after five minutes, and never fails
a search. No API.NSW calls.
**"today", not "since yesterday", on screen:** they mean the same thing (the
move since yesterday's last price is the move made today) and "today" fits
the price column at 320 px.

### The price summary

**Decision:** one sentence over the list: "Cheapest 233.9, average 239.9
cents a litre. Filling 50 litres at the cheapest saves $3.02 on the
average." Of the stations shown, after filters. The mean, not the median: it
is what "average" means to most people, and outliers barely move it when
there are many stations. The saving is left out under 50 cents, and the
whole sentence with fewer than two stations.
**One sentence for screen readers too.** The visible copy has its three
numbers in bold. Chromium's accessibility tree showed it as five fragments,
and VoiceOver on iOS stops at every inline element when swiping. So the
visible copy is `aria-hidden` and a visually hidden copy carries the same
words as plain text. Checked in Chromium: one paragraph, one string.

### Sort and filters

**Decision:**

- **Sort** is a native select, "Cheapest first" or "Nearest first", like
  Fuel and Within. In the URL as `sort=distance`; the list's name follows
  ("Stations, nearest first"), and so does the status ("Listing the nearest
  20"). The "Cheapest" badge stays on the cheapest, wherever it now sits.
- **Filters** are in a closed `<details>`, whose summary says what is in
  force: "Filters: all brands", "Filters: BP and Shell", "Filters: 3 brands,
  recent prices only". So a closed panel never hides that the list is
  filtered. Inside: native checkboxes in a fieldset, in CSS columns, each
  with its count, and "Hide prices not updated for 14 days or more (n)".
  Counts are of what is left after the old-price filter, so they add up to
  the list. In the URL as repeated `brand=` and `old=hide`.
- **Kept across searches**, like the fuel: someone with a Shell card wants
  Shell in the next suburb too. A brand ticked earlier that is not in these
  results is still listed, at 0, so it can be unticked.
- **When filters leave nothing**, the heading says "0 of 19 stations within
  5 km of ..." and the page says "None of the 19 stations match your
  filters", with a Clear filters button that moves focus to the heading
  before it goes.
- **The panel's own Clear filters button is never disabled.** A focused
  button that disables itself drops focus to the page; with nothing to clear
  it does nothing.
- **Brands as FuelCheck names them.** All 63 brand names in the snapshot
  pass the URL check (letters, digits, spaces and `&'.()+-`, up to 40), from
  "7-Eleven" to "PK's" and "Mobil 1 Carlingford Car Care".

The API never sees sort or filters: the results are already on the page, so
there is no extra request, no extra function invocation and no cache miss.

### Directions

**Decision:** a "Directions" link on every station (list, map card and the
station's own page) that opens in a new tab: Apple Maps on iPhone and iPad,
Google's universal directions URL everywhere else, which opens the Google
Maps app where it is installed. iPadOS asks for desktop sites and says
"Macintosh"; a Mac with touch points is an iPad, a real Mac has none.
By coordinates, not the address: FuelCheck addresses are sometimes a highway
and a town. The start is wherever the maps app says you are; our page never
passes the user's position on. `rel="noopener noreferrer"`. Its name is
"Directions to Metro Gosford, opens in a new tab", starting with the visible
word (WCAG 2.5.3). Found in the tests: the space before "to" was inside the
visually hidden text and was trimmed from the name ("Directionsto"); it is
now outside.

### The clear button

**Decision:** a × inside the suburb box, only when there is text, named
"Clear suburb or postcode". It empties the box and puts focus back in it,
ready to type, since the button itself is about to go. It is its own Tab stop
after the box. Clearing is not a search: the results stay until the next one.

### Every fuel at a station

**Decision:** in the station's own page (the history view), above the chart:
a table of every fuel it sells now, price and when it was updated, in the
fuel picker's order, the charted one marked "(chart below)". `/api/history`
already returns the station with every fuel, so it costs no request at all.
Directions are there too.

### Very wide screens, and search controls that stay in view

**Decision:** from 90rem (1440 px) the page grows to 112rem and the search
form moves to a 22rem column of its own on the left, beside the results. It
sticks while the list scrolls, when the window is at least 40rem tall (so a
short window can still reach the bottom of the form). From 100rem (1600 px)
the list stops at 34rem and the map takes the rest: more map is useful,
longer lines of station text are not. Between 960 and 1440 px nothing
changes: there the form is above the list and the map, and making it sticky
would leave the sticky map a slit on a 768 px-tall laptop. Captured in
[wide-light-results.png](screenshots/wide-light-results.png).

### Motion

**Decision:** three animations, transform and opacity only, all inside
`prefers-reduced-motion: no-preference`:

- **New cards** (a search's results, "Show more") rise 6 px and fade from
  half opacity, over 180 ms. Never from invisible, so the price is readable
  from the first frame.
- **Sorting and filtering** slide each card from its old place to its new
  one (FLIP: measure, change, measure, animate the difference as a
  transform), for the first 40 cards, over 220 ms.
- **Saving a favourite** gives the star a quick grow and settle, only after a
  press (stars already saved when the list appears stay still).

**View Transitions, tried and dropped.** The first version wrapped sort and
filter changes in `document.startViewTransition`. In the browser:

1. Its overlay covers the page for the length of the transition and takes
   every click. Ticking a second brand within 200 ms of the first did
   nothing and dropped focus to `<body>`. (`pointer-events: none` on the
   overlay fixes that.)
2. It applies the change a frame late, in its callback. A React-controlled
   checkbox snaps back to unticked until then, which Playwright reported as
   "clicking the checkbox did not change its state", and a screen reader can
   announce the old state. Nothing fixes that while the change is deferred.

The FLIP version changes the page at once, as before, and animates only the
cards' pixels, with nothing over the page. It also works in every browser,
not just those with View Transitions.

**Measured** in Chromium against the build: layout shift (CLS) 0 on load,
and 0 after sorting and filtering with real keyboard and mouse input. With
reduced motion, no animation runs at all.

**Found by the smoke check:** the map check that clicks a station's dot
began failing about half the time. The cause was the check, not the app: it
clicked a card's button during the card's 180 ms entrance, Playwright found
it "not stable", and retried with a forced scroll alignment that moved the
page, so the sticky map was no longer where the check expected. The check now
waits for the cards to settle; 4 of 4 runs pass (as the old build did).

### Library behaviour this relies on

- **`<details>`/`<summary>`:** the summary is the toggle, keyboard included;
  `display: list-item` keeps the browser's marker, which is what says it opens.
- **React controlled inputs:** a checkbox or select shows React's value right
  after the change event. Delay the state update (as View Transitions did)
  and it shows the old value meanwhile.
- **`Element.animate`:** Web Animations, everywhere we support; skipped if
  missing. Transforms do not count as layout shift.
- **CSS `columns`:** fills top to bottom, so reading and Tab order (DOM order)
  match what is seen.
- **`position: sticky`** only sticks within its grid area, which is why the
  form spans both rows of its column.
- **`Intl.NumberFormat('en-AU', { currency: 'AUD' })`:** "$3.02".
- **`URLSearchParams.getAll('brand')`** for repeated parameters; brands are
  sorted when written, so one filter is one URL.
- **The browser's own cache** keeps a prices answer for 60 s (`max-age=60`),
  so for a minute after a deploy new code can receive an old answer without
  `nearest` or `changeCents`. `fetchPrices` fills them in (`[]`, `null`).
- **Playwright** retries a click on an element that is not stable, with a
  forced scroll alignment. Checks that measure positions wait for animations.

### Bundle sizes, round 8

| Payload            | Round 7 | Round 8 | Budget        |
| ------------------ | ------- | ------- | ------------- |
| Initial JS         | 324.2   | 333.9   | 350 (was 332) |
| Initial CSS        | 17.1    | 20.6    | 22 (was 18)   |
| History view chunk | 8.4     | 9.3     | 16            |
| Map chunk          | 1,015.9 | 1,015.9 | 1,100         |
| MapLibre worker    | 496.4   | 496.4   | 540           |

Initial JS grew 9.7 kB raw (3.0 kB gzipped) and CSS 3.5 kB raw (0.7 kB
gzipped), for sort, filters, the summary, today's change, directions, the
clear button and the motion. **Both budgets raised on purpose**, in
`scripts/check-bundle-budget.js`: all of it is on screen with the first
results, so a lazy chunk would only delay it. The new budgets are 5 to 7% over
the new sizes again: room for a small feature, not for a library.

### Testing this round

- **Unit and integration:** the API's nearest list and its 100 km cap,
  change since yesterday (cheaper, dearer, same, unknown, unreadable), the
  day-file cache and its retry; sort, filters and their URL; counts, a
  chosen brand at 0, no-match and its focus; the summary as one spoken
  sentence; today's change in words; directions per platform; the clear
  button by mouse and keyboard; every fuel at a station; the reorder
  animation (and none with reduced motion); axe on each new state.
- **Real browser** (against the build, with production's headers and this
  checkout's `/api` on production's snapshot): `pnpm check:a11y` covers the
  filters open, no-match and nearest states in both themes with contrast on,
  and 1600 px; `pnpm check:browser` covers the summary, sort, a brand filter
  (focus kept), directions, every fuel, nearest stations, the clear button
  and the very wide layout.
- **Screen readers:** checked through Chromium's accessibility tree only.
  NVDA, VoiceOver and TalkBack are on the phone test list.

### Suggestions for later

1. **Offline at the pump.** Country service stations often have one bar of
   signal. A small service worker caching the app shell and the last results
   would show the last prices, clearly marked with their time, instead of an
   error. The manifest is already there; this is the missing half of "add to
   home screen".
2. **Where prices are heading.** Sydney's prices move in a cycle of a few
   weeks. With today's changes already in the answer, the summary could say
   "Most stations here cut prices today" (or raised them), which is the
   question behind "fill up now or wait?". One line, no new data.
3. **Remember the last search** instead of recent searches: open on the last
   place searched (stored on this device, with a way to forget it), which is
   what most returning visitors want and needs no new control on the form.

### After the round: backlog and the suggestions triaged

Decided with the owner after the deploy.

| Item                                  | Call            | Why                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Footer layout shift on desktop        | **Backlog**     | Lighthouse desktop measures CLS 0.053: the footer moves down when results replace the loading placeholder. Already in round 7 (same 0.053 on its deploy), within "good" (under 0.1), and Lighthouse is 100, so not worth a second push. Fix it in the next round that deploys anyway, for example by reserving the results area's height while loading. |
| Offline support                       | **Skip**        | Live prices are the point of the app. Old prices shown offline, however clearly dated, invite a driver to choose a station on numbers that may have changed.                                                                                                                                                                                            |
| Recent searches                       | **Later**       | Pending the owner's phone and screen-reader tests of the suburb box.                                                                                                                                                                                                                                                                                    |
| Open on the last search               | **Later**       | Same: pending the phone tests. The likelier of the two to be built, since it needs no new control.                                                                                                                                                                                                                                                      |
| "Most stations cut prices today" line | Not yet decided | Left as a suggestion.                                                                                                                                                                                                                                                                                                                                   |

## 2026-10-24: Round 9 (audit fixes)

An independent, read-only audit (code, security, compliance) came before
this round. Its findings, and what was decided with the owner:

| ID     | Finding                                                                    | Call                                |
| ------ | -------------------------------------------------------------------------- | ----------------------------------- |
| H1     | Changing the secret reset the lockout count: a path to the third failure   | Fixed                               |
| H2     | Junk query parameters bypassed the CDN; no rate limit; errors never cached | Fixed (a, b, c); team move rejected |
| M1     | A data-call 401 with a fresh token cost 3 calls a run, for ever, unguarded | Fixed                               |
| M2     | The guard failed open: timeouts, failed writes, unreadable records         | Fixed                               |
| M3     | No call count, no monitor, Netlify retried failures a retry cannot fix     | Fixed; monitor set up by the owner  |
| M4     | `main` was unprotected; Netlify deploys whatever is pushed                 | Fixed (ruleset, PR workflow)        |
| L1     | Stale CSP allowances for the removed Netlify badge                         | Fixed                               |
| L2     | `/api/history` read Blobs before checking the station exists               | Fixed                               |
| L3     | `/api/status` published raw error messages                                 | Fixed                               |
| L4     | Actions pinned by tag; no minimum release age                              | Fixed                               |
| L5     | The backfill needs an account-wide token                                   | Documented: short-lived token       |
| L6     | The preconnect told OpenFreeMap about every visitor                        | Fixed                               |
| L7     | The 51st favourite was silently ignored                                    | Fixed                               |
| L8, N3 | Docs out of step with the code                                             | Fixed                               |
| N1, N2 | An unchecked cast; an `eslint-disable`                                     | Fixed                               |
| N4     | Suggestions cached per letter case                                         | Fixed                               |
| N5     | `callsite` shows an unknown licence (its Readme says MIT)                  | Accepted                            |

### GitHub: protections, and pull requests from now on

**Decision:** on `Lyfe4/nsw-fuel-finder`, Dependabot alerts and private
vulnerability reporting turned on (secret scanning and push protection were
already on, as for every public repository). A ruleset, "protect main", on the
default branch: a pull request is required (0 approvals: one maintainer), the
CI check `Typecheck, lint, test, build` from GitHub Actions must pass, force
pushes and deletion are blocked, and nobody can bypass it. "Up to date with
`main`" is not required: with one maintainer it would only force rebases.

**Squash merges, always.** Each pull request becomes one commit on `main`,
named for the round, so every commit on `main` builds and passes on its own.
Round 6 had a commit that did not build alone; with squash merges that cannot
reach `main` again, and `git log main` reads as one line per round. The
branch keeps the step-by-step commits for review, and history is not
rewritten.

**Merging deploys production**, and counts as a round's one production
deploy. Deploy previews of pull requests are allowed:

- They have no API.NSW credentials. `FUEL_API_KEY` and `FUEL_API_SECRET` are
  set for the production context only (checked with
  `netlify env:list --context deploy-preview`: neither is there).
- They cannot run the snapshot job on a schedule ("Scheduled functions only
  run on their schedule for published deploys") or by URL.
- They do share production's Blobs store, which is site-wide. The API only
  reads it. The one way a preview could write to it was a person pressing
  "Run now" on the preview's snapshot function in the Netlify UI, which would
  have written production's `meta/last-run` from a deploy with no
  credentials. The job now does nothing on a `deploy-preview` or
  `branch-deploy` (`runsIn` in `netlify/functions/snapshot/snapshot.ts`). An
  unknown context still runs, so a change on Netlify's side cannot silently
  stop production.

### The lockout guard, rebuilt

API.NSW denies access after three consecutive failed identifications. The old
guard allowed two automatic failures and reset its count when either
credential changed. So two refusals, then a "fixed" secret with a typo in it,
was the third. It also could not see a refusal it never heard back about.

**Decision** (`netlify/lib/upstream/client.ts`):

- **One refusal stops it.** A 401/403 from the token endpoint, or a 401 from
  the data call on a token fetched moments before, stops every automatic
  attempt with that API key until a person runs `pnpm auth:reset`.
- **An unknown outcome counts as a possible refusal.** A token request that
  timed out, never connected, or whose result could not be recorded waits an
  hour before one more try, and two in a row stop the job, as a refusal does.
  The worst case is two failures API.NSW counts, one short of a lockout, and
  that margin is there for a local run.
- **Counted before asking.** The record is written before each token request
  and corrected once the answer is in, so a crash, a timeout or a failed Blobs
  write still leaves it counted.
- **Fails closed.** An unreadable `auth/failure` is treated as locked, not as
  "no failures".
- **Keyed on the API key alone.** A corrected secret is not a fresh start; a
  new API key (a new app) is.
- **A data-call 401 on a stored token** still gets one retry with a fresh
  token, as before: tokens do get revoked. A second 401 on that fresh token
  is a refusal.

**Tests first.** Each scenario was written as a test named for the failure it
prevents, and all eight failed against the old guard before any code changed
(the "record could not be written" one only once its fake Blobs failed every
write after the request).

**The human reset:** `pnpm auth:reset` (`scripts/auth-reset.mjs`) shows the
record, explains that the next run will try once, and deletes it only if
`reset` is typed. It writes to production Blobs only when the owner runs it
with `NETLIFY_SITE_ID` and a short-lived `NETLIFY_AUTH_TOKEN`. It was tested
against a local `BlobsServer` only (left, deleted, nothing there), never
against production.
**Alternatives:** keeping an automatic retry after an hour (a third failure
was one typo away); counting per credential pair (what caused H1).

### Calls counted, and only useful retries

**Decision:**

- **`meta/calls/YYYY-MM`** counts every API.NSW call by Sydney month, failed
  runs included. `/api/status` shows `callsThisMonth` and becomes a 503 above
  2,000, the planned budget, so a leak is seen in days, not at 2,500.
- **`/api/status` publishes the error kind only**, never the message. Messages
  stay in `meta/last-run` and the function log.
- **200, not 502, for failures a retry cannot fix.** A 5xx makes Netlify run
  the scheduled function again within seconds, which spends a call. Only
  `unavailable`, `timeout`, `bad_response` (the null body seen once, which a
  retry did fix) and `internal` get 502. Refusals, locks, `not_configured`,
  `rate_limited`, `request_rejected` and the new `partial_response` get 200
  with `ok: false`, still visible in status.

### Cache keys and the rate limit

**Decision:**

- **`Netlify-Vary: query=<its parameters>`** on every cached route. Verified
  live before the round: Netlify ignores parameter order and a trailing `&`,
  but `&x=1` or a different case was a miss, and so a function run.
- **The client sends one form** of each suggestion query (lower case, single
  spaces).
- **Rate limit: 120 requests a minute per IP address**, then 429, set in the
  API function's own `config` (Legacy Free allows two code-based rules per
  site; this is one). 120 because Australian mobile carriers put many
  customers behind one address (CGNAT), and a search is a handful of
  requests.
- **The function's path moved into its `config`** (`path: '/api/*'`), and the
  `/api/*` rewrite in `netlify.toml` went. With a rewrite, the function was
  also served at `/.netlify/functions/api/*`, where a rate limit on the
  rewrite would not apply. With a custom path, Netlify serves it at that path
  only.
- **Netlify's 429 is not our JSON**, so the client checks the status first and
  says "A lot of searches are coming from your network right now. Please wait
  a minute and try again." It does not retry by itself.
- **`/api/history` checks the snapshot first**, so a made-up station code
  costs no Blobs reads.

**A `netlify dev` quirk found on the way:** a 404 from a function with a
custom path is retried by the CLI as `.html`, `.htm`, `/index.html` and
`/index.htm` before it answers, so locally one 404 is five function runs and
reads "No such endpoint". Netlify staff say production does not do this
(answers.netlify.com, "Netlify is invoking 404 functions 4 extra times").
Confirmed on the deploy preview and on production: an unknown station and an
unknown place each come back with their own message ("FuelCheck no longer
lists that station.", "We couldn't find Zzzyzx in NSW or the ACT."), not "No
such endpoint".

### Not moving to a team of its own (accepted risk)

**Rejected:** moving the site to a separate Netlify team so that a spike could
only pause this site. New teams are created on the credit-based plan, which
must be avoided.

**What Legacy Free does at a limit**, from Netlify's billing FAQ for legacy
plans (read 2026-10-24):

- Email notifications at 50%, 75%, 90% and 100% of a limit.
- Build minutes at 100%: new builds stop for every site on the account; the
  sites keep serving.
- **Any other metered feature at 100%: new builds stop and every site on the
  account is paused**, until a payment method is added and the account is
  upgraded to a paid plan. Deleting the site does not restore the others.
- No extra usage packages on the free tier.

**A correction to the audit:** Netlify's legacy plan table gives serverless
functions as "125k invocations per site/month", so this site's invocations
are its own, not shared by the 16 sites. Being paused is still shared. Bandwidth
(100 GB a month) is an account-wide hard limit, and the rate limit covers
`/api/*` only: static files (the 1.5 MB map chunk and worker) are not limited.
Raised with the owner as an open item.

**Mitigated by:** the cache keys and the rate limit (above), the call count
in `/api/status`, Netlify's usage emails, and an uptime monitor on
`/api/status` every 15 minutes (set up by the owner after this round; each
check is a function run, about 2,900 a month).

### Content-Security-Policy, tightened

**Decision:** `script-src 'self'` plus the theme script's hash only;
`style-src 'self'` (no `'unsafe-inline'`); `frame-src 'none'` in place of
`child-src 'self'`. The badge that needed the rest is no longer served
(checked live: no `/.netlify/scripts/hud` tag in the page).

**Verified before the pull request** with `pnpm serve:headers` and
`pnpm check:browser`: 45 of 45 checks, no violations on the wide screen or the
phone map, so nothing in the app needed inline styles. React and MapLibre set
styles through the CSSOM, which CSP does not govern.

**If the badge comes back,** the policy blocks it, and `check:browser` fails
on "Netlify's badge is not served", saying so. `serve:headers --with-badge`
injects it the way Netlify did; under it the check failed as intended, with
the blocked inline script and styles in the console. The fix then is a
decision: allow it again (its script hash, plus inline styles, as in round 7)
or hide it.

### Privacy

**Decision:** a short privacy note at `/privacy.html` (static, no script,
linked from the footer) and in the README. Each point is true of the code as
of this round, and the page's comments name the code behind each one.

**The preconnect to OpenFreeMap is gone.** It opened a connection on every
page load, so OpenFreeMap learnt every visitor's address, map or no map. The
map's warm-up (`warmMapResources`) already fetches the style, tile index and
fonts as soon as a map is coming, which is what the preconnect sped up. A test
now fails if `index.html` names any other site.

### Supply chain

- Actions pinned to commits with the release in a comment, which Dependabot
  keeps updated. `pnpm/action-setup` is pinned at v6.0.10, the release the
  `v6` tag pointed to (not the newer v6.1.0), so CI behaves exactly as before;
  Dependabot will propose 6.1.0. CI also has a 15-minute timeout.
- `minimumReleaseAge: 1440` in `pnpm-workspace.yaml`: no version newer than a
  day, the window in which most malicious releases are found and pulled.

### Smaller fixes

- **Favourites:** at 50 a press says "You already have 50 favourites, the most
  this device keeps. Remove one to add this station." (an alert: the press
  failed), and the button stays enabled.
- **The fold's progress record is parsed**, not cast; an unreadable one starts
  the day again rather than skipping stations.
- **`StationList` uses `useEffectEvent`** for its scroll, instead of an
  `eslint-disable`.
- **Docs:** README, api-notes (routes, Blobs layout, failures, caching), the
  snapshot size, and a test path in a comment.

### Library behaviour this relies on

- **Netlify caching:** a function response is keyed on every query parameter
  unless `Netlify-Vary: query=a|b` names some; order is ignored; names and
  values are case-sensitive; the same URL must always send the same
  `Netlify-Vary` (the first one cached wins).
- **Netlify rate limiting:** code-based only on Legacy Free, two rules per
  site, per IP and domain; counted at the edge before the function, cache
  hits included; up to about 10 s before blocking starts; 429 by default.
- **Netlify functions:** with a `config.path`, a function is not also served
  at `/.netlify/functions/<name>`.
- **Netlify scheduled functions:** run on published deploys only; not callable
  by URL; "Run now" in the UI works on previews too; a 5xx is retried.
- **Netlify Blobs:** one store per site, shared by every deploy, previews
  included; each `setJSON` is atomic per key, with no transactions across keys.
- **`AbortSignal.timeout`:** a `TimeoutError` with no response, so a timed-out
  token request is an unknown outcome.
- **React 19 `useEffectEvent`:** reads the latest props without being a
  dependency; only to be called from effects.

### Verified after the merge

Pull request #1, squash-merged as `6215c49` at 09:04 UTC; production served
it about 10 seconds later.

- **Cache keys:** `?query=…&junk=1`, the parameters reordered, and `&utm_source=x`
  on a prices search were all Durable or Edge hits; a different letter case is
  still a miss, as documented.
- **Rate limit:** the deploy lists the rule (`sliding_window`, 120 per 60 s,
  keyed on ip and domain). 140 cached requests in one second all got 200,
  because enforcement takes a few seconds to start; within seconds every
  request from that address got 429 (no body), and 200 again after about 30 s.
- **Routing:** `/.netlify/functions/api/status` is the static 404 page; 404s
  from the API carry their own message (see the `netlify dev` quirk above).
- **CSP:** `pnpm check:browser` on production, 45 of 45, no violations, and
  "Netlify's badge is not served" passes. `pnpm check:a11y`, 34 of 34.
- **Lighthouse** (12.8.2, a results page for 2250): 100 / 100 / 100 / 100 on
  mobile and desktop. Mobile LCP 1.4 s, CLS 0; desktop LCP 0.3 s, CLS 0.053.
  The footer shift from the round 8 backlog is still there: this round did
  not touch it.
- **/api/status** shows `callsThisMonth`. The first scheduled run under the new code (09:30 UTC) succeeded and wrote `meta/calls/2026-10`: `callsThisMonth` 1 (one price call, the token was stored). The count starts there, so it leaves out October's ~70 earlier calls; the API.NSW dashboard stays the authority until November.

**Deploy previews and the Netlify Drawer.** `check:browser` on the deploy
preview failed 3 checks, all from the Netlify Drawer that previews inject
(`/.netlify/scripts/cdp`): an inline `style` attribute and a frame from
`app.netlify.com`, both refused by the policy. Production has no Drawer. It
was already broken before this round (`child-src 'self'` refused its frame).
Either turn the Drawer off for previews (Site configuration > Build & deploy >
Deploy Previews > Netlify Drawer) or read those 3 as preview-only.

## 2026-10-25: Round 10 (last items before the baseline)

### A rate limit on the static files

**Decision:** the second code-based rule Legacy Free allows, in
`netlify.toml`: a rewrite of `/*` to itself (status 200, not forced) with
`rate_limit` 600 requests per 60 s, keyed on IP and domain, then Netlify's 429. Round 9 left static files unlimited, and bandwidth (100 GB a month) is
account-wide: reaching it pauses all 16 sites.

**Why 600, as the owner suggested, not lower.** Measured on production: a
cold first visit on a wide screen, with the map, is about 8 requests to this
origin (the page, bundle, stylesheet, map chunk, map stylesheet, worker,
icon); a phone on the list fewer; a later search none, since `/assets/*` is
cached for a year. 600 is about 75 cold visits a minute from one address, so
no CGNAT pool, office or school meets it. Lower would not change the outcome
that matters: the biggest file is the map chunk, 1.04 MB uncompressed (267 kB
with Brotli), so at 600 a minute one machine pulls at most about 37 GB an
hour. A machine on a data-centre link, unlimited, could take the month's
100 GB in about a quarter of an hour; at the limit it takes nearly three
hours, and Netlify's 50% and 75% emails come first. Halving the limit would
only stretch that to about five and a half hours, at a real risk to shared
addresses. A per-address limit does nothing against many addresses; that
stays an accepted risk (see the baseline).

**Status 200 is required.** A redirect with no `status` is a 301, so `/*` to
`/:splat` would send every missing page to itself in a loop. Not forced, so it
never shadows a file or the API function. Checked on the preview: files 200,
missing pages 404 (no redirect), `/api/status` 200, `/api/nope` the API's own
404, `/.netlify/functions/api/status` still the static 404.

**It counts `/api` requests too (accepted).** The brief asked for no overlap
with the `/api` rule. Netlify cannot give one: a rule's limit applies to every
path its `from` matches, and there is no "everything but `/api`". An earlier
rule `/api/*` to `/api/:splat` with no limit was tried and made no difference:
the limit is not first-match like the rewrites themselves. Limiting
`/assets/*` only would avoid the overlap but leave `og-image.png` (397 kB) and
every other root file unlimited. So `/*` stays, and the overlap is harmless:
`/api` keeps its own, stricter 120, and only an address making 480 other
requests a minute on top of that meets 600. Such an address is refused `/api`
as well, which is right for it. The other way round, tripping `/api`'s limit
does not block files, so a busy CGNAT pool refused searches can still load the
page and read why.

**Verified on the deploy preview** (`burst.mjs`, a scratch script; previews
have their own domain, so the tests could not block production). Requests
paced at 12 a second:

| Test                                                                | Result                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 700 to `/robots.txt` in 58 s                                        | 603 × 200, then refused from about 50 s (one 429, the rest Netlify's challenge, see below) |
| then, 12 s after the burst                                          | `/robots.txt` 429, `/api/places` 429: the static rule refuses `/api` too                   |
| 140 to `/api/places` in 12 s (the round 9 rule)                     | all 200 in the burst; 12 s later `/api` 429                                                |
| static files during and after that `/api` block                     | 200 throughout: the rules block separately, by rule                                        |
| 115 `/api` + 545 static in 55 s, with and without the `/api/*` rule | the same both times: refused from about 51 s, both kinds                                   |

Blocked requests do not seem to count: after a burst that was cut off by the
challenge, the window cleared within 12 s.

**Two things learnt the hard way:**

- **Netlify's own bot protection answers before the limit.** The first test
  sent 700 requests in 0.9 s: after 507 came 403s, and then the edge refused
  this address outright (connection timeouts) on both the preview and
  production for about 8 minutes. Production kept serving everyone else: the
  API function logged other visitors' requests during the block, and the
  02:00 snapshot ran. After a few more bursts, even 12 a second drew the same
  403 page ("Security by Netlify", a JavaScript challenge) at about 600 a
  minute, for `/api` as well. So the bursts are paced, kept short, and
  spaced two minutes apart, and a 403 with that page is Netlify's protection,
  not our rule (ours is an empty 429).
- **A paced test must keep each stream well under its own limit**, or a
  sliding window cannot tell which rule refused it: the first mixed test ran
  `/api` at 125 a minute, over its own 120.

### The footer no longer moves

**The cause, measured** (a `PerformanceObserver` on production at
Lighthouse's desktop size, 1350 × 940): the footer, at y 836 under three
loading cards, was pushed off screen when 19 stations arrived 3.7 s in, a
shift of 0.052. On a phone and at 1280 × 800 it was already below the fold,
so CLS there was 0.

**Decision:** on wide screens (from 60 rem, where list and map sit side by
side), the loading cards, and "Finding your location…", keep a minimum height
equal to the sticky map's (`--map-panel-height`, now a token that
`StationsPanel` uses too). Results there are never shorter than the map
beside them, so the space reserved is space the results would fill anyway,
and the footer starts below the fold. Phones are unchanged.

**A side effect, accepted:** if a location search ends in an error or
nothing found, the shorter message replaces the reserved space and the footer
moves up. Those are rare, and the shift comes after a press.

**Measured on the preview:** CLS 0 at 1350 × 940, 1920 × 1080, 1280 × 1400,
960 × 900 and 412 × 823 (it was 0.052 on production at the first size).

**A test for it:** `check:browser` now loads a results page at 1350 × 940
and fails if CLS reaches 0.01. Against production before the fix it failed
with 0.052; at 1280 × 800, its existing wide size, it had passed (0.000),
which is why the shift was never caught.

### The Netlify Drawer, off for previews

The owner turned the Drawer off for deploy previews. `check:browser` on the
round 10 preview (`cb89fc5`): 46 of 46, no CSP violations, and no
`/.netlify/scripts/` tag in the page (round 9's preview failed 3 checks, all
from the Drawer). `check:a11y`: 34 of 34. Previews now pass cleanly.

### Uptime monitor

UptimeRobot checks `https://nsw-fuel-finder.netlify.app/api/status` every 15
minutes and emails the owner on anything but a 200, set up by the owner after
round 9. Now in the README's maintenance section, with what a 503 means.

### Library behaviour this relies on

- **Netlify redirect rate limits** (`[redirects.rate_limit]`): code-based,
  so they count against the plan's two rules; validated after the deploy,
  where a bad rule is a log message, not a failed deploy; the limit applies
  to every request the `from` pattern matches, files included and whatever
  the rule order; up to about 10 s before blocking starts; 429 with an empty
  body; each rule blocks only its own paths.
- **Netlify redirects:** no `status` means 301; a rule that is not forced does
  not shadow an existing file or function.
- **Netlify's bot protection:** a flood is met with 403s and then a refused
  connection for the address, on the preview and production alike, for minutes; a
  JavaScript challenge page can come back on later, slower bursts.
- **Layout Instability API:** shifts within 500 ms of input are left out
  (`hadRecentInput`), as Lighthouse does; a shift counts only the part of the
  viewport the moved element covers, before and after.

### Verified after the merge

Pull request #3, squash-merged as `d6dc135`; production published it at
02:32:35 UTC on 25 October.

- **Checks:** `pnpm check:browser` on production, 46 of 46, CLS 0.000 at
  1350 × 940, no CSP violations; `pnpm check:a11y`, 34 of 34. `/api/status`
  healthy.
- **Rate limit:** the deploy reports "1 redirect rule processed … without
  errors" alongside the `/api` function's rule. A paced burst from this
  address (12 a second) met Netlify's bot challenge after about 390
  requests, before our rule's 600, as it had on the preview after several
  bursts: Netlify had flagged the address. Files and `/api` were 200 again
  12 s later. So our 429 was seen on the preview, not on production; the
  rule and the configuration are the same.
- **Lighthouse:** CLS 0 on desktop and mobile in every run, so the footer
  shift is gone. Accessibility, Best Practices and SEO 100 in every run.
  Performance was not 100 today, and not because of this round:

  | Run                                                          | Desktop                      | Mobile                      |
  | ------------------------------------------------------------ | ---------------------------- | --------------------------- |
  | Local 12.8.2, production, 4 runs each                        | 92–96, CLS 0, LCP 1.0 s      | 90–94, CLS 0, LCP 1.5–1.7 s |
  | Local A/B, same minutes: round 9's deploy / round 10's       | 86–96 / 97–98, CLS 0.053 / 0 | 95 / 95–97, CLS 0 / 0       |
  | PageSpeed Insights (Lighthouse 13.5): round 9's / round 10's | 71 / 69, CLS 0.053 / 0       | 99 / 99, CLS 0 / 0          |

  The local machine was busy (a game running, 54% CPU), which costs
  Lighthouse blocking time: round 9's code scored no better under the same
  load. On PageSpeed's desktop, blocking time is 700–900 ms in both rounds:
  MapLibre drawing the map on a machine without a GPU. Desktop LCP moved
  from 0.6 s to 1.0 s locally because the LCP element is now the price
  summary, which waits for the data, not the footer paragraph painted while
  loading: a truer number, not a slower page. Lighthouse should be run again
  on an idle machine to confirm the 100s.

## 2026-10-25: Round 11 (final hardening)

### The wide map waits where WebGL is drawn in software

**The cause, measured.** PageSpeed Insights' desktop test on a results page
for 2250 scored 68: Total Blocking Time 990 ms, CLS 0, LCP 0.6 s. Its long
tasks were almost all in the map chunk (1.3 s of them between 1.2 and 2.7 s;
"Other" 1,320 ms in the main-thread breakdown). A CPU profile of the same
load in headless Chromium put the time in native code under MapLibre's
`getProgram`: compiling its shaders and drawing the first frames, in
software. Google's machines have no GPU, so WebGL runs on SwiftShader. The
same page with a GPU blocks for 0 ms (Chromium with D3D11 on this PC, warm;
about 100 ms cold, as before this round), with SwiftShader about 220 ms
here, and roughly four times that on PageSpeed's slower machine.

**Why not just defer the start.** The brief suggested starting the map once
the list has rendered and the browser is idle, or when the map nears the
viewport. Both alone would leave the score where it was. Lighthouse counts
blocking from first paint to Time to Interactive, which only ends after five
quiet seconds, so the same long tasks a moment later still count; and on a
wide screen the map is in the viewport from the start. Only a delay of more
than five seconds would hide them, which would be a worse page for every
visitor, to fool the test.

**Decision:** the map starts once the list has rendered and the browser is
idle (`requestIdleCallback`, at most a second; a timeout in Safari), behind
the existing "Loading map…" placeholder. Before it starts, a throwaway WebGL
context asks for the renderer's name (`src/features/map/mapStart.ts`). If it
is a software renderer (SwiftShader, llvmpipe, softpipe, Windows' Basic
Render Driver), the map waits: the placeholder says why and offers "Show the
map". A "Show on map" in the list starts it too. The first press is
remembered for the rest of the visit. Nothing is downloaded from MapLibre or
OpenFreeMap until then.

- **With a GPU nothing changes**, apart from the map starting a frame or two
  later. An unknown renderer, or a browser that hides it, counts as a GPU:
  the map starts as before. No WebGL at all also starts it, so the map's own
  "couldn't be shown" message still appears.
- **Without one**, the visitor gets a responsive list at once and the map on
  one press, instead of a page frozen for one to several seconds. Chrome is
  dropping its automatic SwiftShader fallback, so for real visitors this is
  mostly Firefox on llvmpipe, virtual machines and blocklisted drivers.
- **Focus:** the button goes away when pressed, so focus moves to the
  "Loading map…" placeholder (in a layout effect) and then to the map's
  canvas once it exists. The second move is necessarily after the download,
  so it only happens if focus is still on nothing (`<body>`): it can never
  take focus from something the visitor chose meanwhile. The lint rule
  against deferred focus is disabled for that one line, with the reason.
  "Show on map" leaves focus on the list button, as before.
- **Layout:** the offer fills the same frame as the map, so nothing moves;
  its text sits at the top of the panel, which is as tall as the window and
  can start below the fold.

**Considered and rejected:** `failIfMajorPerformanceCaveat` (MapLibre's
context option), the standard way to refuse software WebGL. Chromium with
SwiftShader returned a context anyway in both modes tested, so it does not
detect the case that matters. Lowering MapLibre's cost (fewer layers, no
label fade) cannot remove the shader compiles, which are most of it.

**Measured** (PageSpeed Insights, Google's servers, a results page for 2250):

| Page                                 | Desktop               | Mobile                |
| ------------------------------------ | --------------------- | --------------------- |
| Production before (round 10)         | 68, TBT 990 ms, CLS 0 | 99, TBT 30 ms, CLS 0  |
| Round 11 deploy preview (`round-11`) | 99, TBT 0 ms, CLS 0   | 100, TBT 40 ms, CLS 0 |

Accessibility and Best Practices 100 in all four; the preview's SEO is 66
only because previews are `noindex`. Locally, against the build with
production headers: no long tasks after first paint with SwiftShader (there
were four or five), and the map starting by itself with the GPU.

**What the score measures, honestly.** PageSpeed's desktop test runs on a
machine without a GPU, so after this round it takes the "Show the map" path:
the 100 is the page without a map, not the map drawn faster. Read it as the
page a GPU-less visitor now gets: the list usable at once, the map one press
away. A visitor with a GPU sees no change; their page was never slow (about
0 ms of blocking on real hardware, measured above), and PageSpeed cannot
show it, having no GPU. The score is not evidence that the map got cheaper;
it did not.

**Where the renderer's name is hidden, the map starts as before.** The code
reads `RENDERER`, and only if that is Chrome's mask ("WebKit WebGL") asks
`WEBGL_debug_renderer_info`. A name that does not match the software list,
including a masked one, counts as a GPU. Checked in real browsers against
production, at 1350 × 940:

| Browser                                        | Renderer it reports                  | Wide map          |
| ---------------------------------------------- | ------------------------------------ | ----------------- |
| Chromium, SwiftShader                          | "WebKit WebGL"; debug: SwiftShader   | waits for a press |
| Chromium, SwiftShader, debug extension removed | "WebKit WebGL"; debug: unavailable   | starts by itself  |
| Firefox (Playwright, GPU)                      | a bucketed GPU name, "…, or similar" | starts by itself  |
| Firefox, `privacy.resistFingerprinting`        | "Mozilla"                            | starts by itself  |

So a GPU-less browser that hides the name gets the map at once, and the
slow first draw, exactly as before this round. That is the safe direction:
a mistaken guess can cost speed, never the map.

**Tests:** six new unit tests (the start with a GPU, the offer and the
remembered press, "Show on map", no WebGL, focus to the canvas and not
stolen). `check:browser` now asks the page's renderer: with software WebGL
(headless Chromium, here and in CI) it checks that the wide map waits having
fetched nothing, that "Show the map" starts it with focus on the map, and
that the next search does not ask again; with a GPU, that the map starts by
itself. `check:a11y` runs axe on the offer in both themes, and
`pnpm screenshots` presses the button so the README's pictures still show
the map. 49 and 36 checks.

### Browser checks in CI

**Decision:** a second workflow, `browser-checks.yml`, runs `check:browser`
and `check:a11y` on every pull request against that pull request's Netlify
deploy preview, as the job "Browser checks on the deploy preview".

**How it knows the preview is ready.** Netlify posts a commit status,
`netlify/nsw-fuel-finder/deploy-preview`, on the head commit: "processing"
(linking the deploy log), then "Deploy Preview ready!" (linking the pull
request's alias) or a failure. It does not create GitHub deployments, so
`deployment_status` cannot be used. `scripts/wait-for-preview.mjs` polls the
status every 10 s, for up to 15 minutes, while the job installs, and then
tests that deploy's own permalink (`<deploy id>--nsw-fuel-finder`), so a
later push cannot change the site under the checks. A failed deploy fails
the check. Runs on an older commit are cancelled by a newer push.

**Docs-only pull requests.** A required check that never reports blocks
merging forever, so the workflow always runs and decides for itself:

- If the pull request changes nothing outside `docs/` and Markdown (the same
  rule as `ignore` in `netlify.toml`, read from the pull request's file list),
  Netlify never builds it, and the job passes in seconds, saying why in its
  summary. Tried on pull request #4's files.
- If the pull request changes code but its latest commit only changes docs,
  Netlify skips that commit ("Deploy Preview canceled.", state success). The
  site has not changed since the pull request's last preview, so the checks
  run on that preview, `deploy-preview-<n>`. Tried on #3's last commit.

**Security.** `pull_request`, not `pull_request_target`: a fork's pull
request gets a read-only token and no secrets, and the workflow uses none.
Permissions are `contents`, `pull-requests` and `statuses`, all read. The
checkout keeps no credentials. Actions are pinned to commits, as in `ci.yml`,
and Dependabot's monthly actions update covers the new ones. The preview URL
is checked against Netlify's host pattern and passed to the shell through an
environment variable, never pasted into a command.

**Lean.** Chromium's headless shell only (`--only-shell`), cached by
Playwright's version; the runner already has its libraries. Screenshots are
uploaded only when a check fails, kept 7 days.

**First run, on this pull request:** 1 min 52 s in all. Install 15 s, the
browser 4 s (cold cache; saved for next time), waiting for the preview 11 s,
`check:browser` 17 s (49 of 49), `check:a11y` 57 s (36 of 36). Each run
costs the preview a few function runs and some OpenFreeMap tiles, and no
API.NSW calls. Netlify's bot protection did not challenge GitHub's runners.

### Library behaviour this relies on

- **Lighthouse TBT:** the sum over 50 ms of each long task between First
  Contentful Paint and Time to Interactive, which needs five seconds without
  long tasks. Desktop runs unthrottled CPU on Google's own machines, which
  have no GPU.
- **WebGL renderer names:** Chromium masks `RENDERER` as "WebKit WebGL" and
  gives the real name through `WEBGL_debug_renderer_info`; Firefox gives it in
  `RENDERER` and has deprecated the extension. `WEBGL_lose_context` frees the
  probe's context at once (browsers allow about 16). The first context in a
  page costs the GPU process start (60 to 270 ms here), which the map's own
  context would otherwise pay.
- **`failIfMajorPerformanceCaveat`:** honoured inconsistently; Chromium gave
  SwiftShader contexts with it set.
- **`requestIdleCallback`:** not in Safari; the `timeout` option bounds the
  wait.
- **Netlify commit statuses:** posted on the head commit by the Netlify app;
  "ready" links the alias, "processing" the deploy; a build skipped by
  `ignore` is "Deploy Preview canceled." with state success.
- **GitHub Actions:** a required check from a workflow that does not run
  (path filters, skipped workflow) stays pending; a job that runs and skips
  its own steps reports success. `pull_request` from a fork: read-only token,
  no secrets. Caches written by a pull request are visible only to that pull
  request and are not trusted by `main`.

### Verified after the merge

Pull request #5, squash-merged as `0112706`; production published it at
06:45:50 UTC on 25 October.

- **The new check on its own pull request:** the first commit ran on its
  deploy's permalink (49 of 49, 36 of 36, 1 min 52 s); the docs commit, which
  Netlify skipped, ran on `deploy-preview-5` (the same, 1 min 40 s).
- **Production:** `pnpm check:browser` 49 of 49 (the wide map waited, having
  fetched nothing from MapLibre or OpenFreeMap, and took focus when started);
  `pnpm check:a11y` 36 of 36; `/api/status` 200.
- **PageSpeed Insights on production**, a results page for 2250: desktop
  100 (TBT 0 ms, CLS 0, LCP 0.4 s), mobile 99 (TBT 0 ms, CLS 0, LCP 1.4 s);
  accessibility, best practices and SEO 100 on both. Before: desktop 68
  (TBT 990 ms), mobile 99. The desktop run took the "Show the map" path
  (see "What the score measures" above).
- **Ruleset:** "protect main" (id 25775726) now requires both checks. Read
  back after the change (`gh api repos/Lyfe4/nsw-fuel-finder/rulesets/25775726`):
  enforcement active, no bypass actors, target the default branch; rules
  `pull_request` (0 approvals), `required_status_checks` with "Typecheck,
  lint, test, build" and "Browser checks on the deploy preview" (both
  GitHub Actions, integration 15368, not strict), `non_fast_forward`,
  `deletion`. Updated 25 October 08:54 UTC.

## 2026-10-28: Round 12 (map selection, from the phone test)

The owner's phone test passed everything but the map's selection: it could
only be undone by picking another station or pressing Close, and selecting a
station in a dense area made its neighbours vanish.

### A tap on nothing clears the selection

**Decision:** a tap or click on the map away from every station (outside the
12 px pick radius) clears `station=` from the URL and closes the card. A drag,
a pinch, a double-tap and a double-click do not.

- **What counts as a tap.** MapLibre fires `click` only for a press released
  within 3 px of where it started, and browsers fire no click after a touch
  that moved (MapLibre cancels the touchmove) or used two fingers. So drags
  and pinches never reach the handler. Double-taps and double-clicks do:
  their first tap is a click, and the gesture is a zoom.
- **So the clear waits 300 ms**, and the next press (`touchstart` or
  `mousedown`), a `dblclick` or any camera move (`movestart`) cancels it. A
  double-tap's second press comes well inside that, and MapLibre allows
  500 ms between the taps of a double-tap; one slower than 300 ms clears the
  selection as well as zooming, which is harmless. A station chosen in the
  list during the wait is not undone, and nothing fires after the map is
  removed.
- **Keyboard.** Escape anywhere in the map's panel clears the selection. In
  the card it is the card's Close (focus to the list button on a wide screen,
  to the Map switch on a phone). On the map itself the map keeps focus. The
  listener is a native one on the panel: a React `onKeyDown` there would make
  jsx-a11y call a plain `<div>` interactive. With nothing selected, Escape
  does nothing and is not swallowed.
- **Focus never lands on `<body>`.** A tap clears with the new focus target
  `map`: focus stays wherever it is, unless it was inside the card, which
  takes it to `<body>` as it goes; then it moves to the map's canvas, in the
  same layout effect as every other move (`selection.ts`).
- **The map's height.** The card under the map goes, so on a wide screen the
  map grows. Nothing is panned on a clear, and MapLibre keeps the centre on
  resize, as after Close. The earlier fix (resize before panning to a
  selection) is untouched, and the smoke check's re-pick at the centre after
  Close still passes.

### The selected station no longer hides its neighbours

**The cause, seen on production** (Parramatta, 25 km, Ampol Foodary
Granville selected, desktop and phone, both themes): nothing was dropped.
Circles take no part in MapLibre's collision detection, so every dot was
always drawn, but things were drawn over them. The selected dot (13 px
radius, above every other dot) hid a station 8 px away, Budget Granville,
completely; its bold price (allowed to overlap, drawn above the dots) covered
another; and ordinary prices, which only avoided each other, sat on dots all
over a dense search, selection or not.

**Decision:** one rule, written at the top of `mapLayers.ts`: every dot is
always drawn, and nothing but the search origin is drawn over one. Prices
make way for dots, never the other way round.

- **Layer order** (bottom up): the selected marker, the prices, the selected
  price, the dots, the origin. The selected marker replaces its station's own
  dot (filtered out of the dots layer) and keeps its look, a bigger filled
  disc with a heavy edge, so its shape still differs from the origin's hollow
  ring. A neighbour that overlaps it is drawn over its edge.
- **Prices avoid dots.** An invisible symbol layer puts a dot-sized,
  transparent icon on every station, with `icon-allow-overlap` (always
  placed) and not `icon-ignore-placement` (in every price's way). It is the
  top layer, so MapLibre places it first. Prices are offset 0.8 em, enough to
  clear their own dot.
- **The selected price is always shown, beside a free spot if there is one.**
  Eight anchors with `text-allow-overlap`: MapLibre tries every anchor without
  overlap first and overlaps only if none is free; even then the dots are
  drawn over it. Its ordinary label stays hidden, as before.

**Considered.** Offsetting the selected label alone fixes the label but not
the bigger dot or the ordinary prices. Drawing the selected marker on top at
the normal size makes the selection hard to see. A shrunken collision box
would change nothing: circles have none.

**The cost:** fewer prices in a dense view, since a price that would cover a
dot is now dropped. The cheapest still win the space (`symbol-sort-key`), and
zooming in shows the rest, as before.

### Tests

- 21 new unit tests (588 in all): the selection rules for a tap and Escape;
  in `StationMap`, a tap on nothing clears after the wait, and a drag, a
  pinch, a double-click and a double-tap do not, nor a tap with nothing
  selected, after a list pick, or after unmount; the layer order and the
  dot-space layer; in the app, the URL, the card and focus for a tap and for
  Escape on a phone and a wide screen, with axe.
- **The hidden-renderer case from round 11, permanently:** Chrome without
  its debug extension ("WebKit WebGL") and Firefox with fingerprinting
  protection ("Mozilla") start the map by themselves, and Chrome whose debug
  extension names SwiftShader waits for "Show the map".
- `check:browser` gains 8 checks (57): Escape on the map; a mouse drag; a
  click on nothing (it tries a few spots away from the centre, since any spot
  may hold a station); and on the phone, with real touch input through the
  DevTools protocol, a one-finger drag and a pinch, a double-tap, and a tap
  on nothing. With the cancel on a second press removed, the double-tap check
  fails, so it does test the race.
- The double-click, double-tap, tap-focus and Escape tests were checked to
  fail with their code removed.

### Library behaviour this relies on

- **MapLibre `click`:** fired by its map event handler only when the press is
  released within `clickTolerance` (3 px) of where it started. Its
  `touchmove` listener is not passive and its touch pan and zoom call
  `preventDefault`, so no click follows a touch drag or pinch.
- **MapLibre double-tap zoom:** the second tap's `touchend` is
  `preventDefault`ed (no click for it); the first tap's click is not. Up to
  500 ms between taps. Double-click: two clicks, then `dblclick`, then an
  `easeTo` (`movestart`).
- **MapLibre placement:** layers are placed from the top down; a symbol with
  allow-overlap still enters the collision index unless it ignores
  placement; with variable anchors and overlap allowed, every anchor is
  tried without overlap first (`placement.ts`). Circle layers take no part.
- **`setStyle(..., { diff: false })`** drops images added with `addImage`, so
  the dot-space icon is added again on every `style.load`.
- **Focus:** removing the focused element leaves `document.activeElement` on
  `<body>`, which is what the `map` target looks for.

### Verified after the merge

Pull request #7, squash-merged as `eddd797`; production published it at
23:51 UTC on 27 October (10:51 on the 28th in Sydney).

- **On its deploy preview, in CI:** both required checks passed;
  `check:browser` 57 of 57, `check:a11y` 36 of 36.
- **Production:** `pnpm check:browser` 57 of 57, including all eight new
  checks (Escape on the map; mouse drag; click on nothing; touch drag and
  pinch; double-tap; tap on nothing, the phone staying on the map);
  `pnpm check:a11y` 36 of 36; `/api/status` 200, healthy, 183 API.NSW calls
  counted this month.
- **Before and after on production**, Parramatta at 25 km with Ampol Foodary
  Granville selected, at 1350 × 940 and 390 × 844, light and dark: before,
  Budget Granville was hidden under the selected dot and two dots under
  prices; after, every dot is drawn, the selected price sits above its
  marker, and the neighbour shows over the marker's edge.

## 2026-10-28: Round 13 (the redesign: Docket)

The whole visual layer and a review of what each screen shows, in pull
request #9. The proposals, mockups and the owner's choices are in
`docs/design-directions/`; the result is specified in
`docs/design-system.md`, which is now the source of truth for the look.

### A servo docket, minimal

**Decision:** of three directions (Price Board, Road Atlas, Docket), the
owner chose Docket, then a minimal version of it: paper on a counter, ink,
one accent (carbon blue) used only for meaning, Atkinson Hyperlegible Next
and Mono, dotted leaders, one torn edge. Only what a screen needs is on it.

**Why:** the price is the hero; the old screens buried it (the first price
on a phone was below the first screen). Atkinson was made for low-vision
readers, which a segment face (Price Board's) failed: its decimal point
vanished when blurred (`docs/design-directions/png/legibility.png`).

### What moved, and where

- **A station is one line**, an `<h3>` holding one button (the accordion
  pattern): name, leader, price; distance and age. Its card (brand,
  address, today's move, price history, Directions, Favourite, Close) opens
  under it at every width, and under the map on a phone's map. "Show on
  map" and "Show in list" are gone: the row selects the station, and the
  List/Map switch shows it.
- **The search folds** into one line on a phone after a search; the fuel
  stays a select there (one tap), Change opens the rest. A failed search
  keeps it open with focus in the place box.
- **One-row toolbar**, one-line summary, favourites hidden until there is
  one, theme in the footer, the name "Fuel Finder" with "NSW · ACT".
- **On a GPU-less wide screen**, opening a row does not start the software
  map (its first draw freezes the page); "Show the map" is the one way.

### The map

OpenFreeMap's style restyled in our tokens at every `style.load`
(`basemap.ts`), not a hosted style of our own: nothing to keep in step with
their tiles. Prices are boxed tags; the cheapest has a layer of its own,
placed before all but the selected price, so it is never dropped. Labels
stay in OpenFreeMap's Noto: our own glyph PBFs (about 250 kB, our bandwidth)
were not worth it for this direction.

### Addresses

A suburb in capitals in an otherwise careful address ("WYOMING") takes the
ABS gazetteer's spelling, in the API (`mendAddressCase`); all-capital
addresses are set in title case in the browser (`formatAddress`). Neither
touches what it does not recognise.

### Layout shift on phones (found by PageSpeed)

The preview's first PageSpeed mobile run had CLS 0.266: the one-line rows'
loading placeholders no longer filled a phone screen, so the footer was in
view while prices loaded, and moved. The loading state now holds a screen's
height. `check:browser` measures layout shift at a phone size too, with the
prices held back so the loading state paints; it reproduced 0.267 before the
fix.

### Two tests that failed under load

- **History (a real race):** the view's body is lazily imported, and the
  first test to need it timed a cold import (module and CSS transform)
  against `findBy`'s one second. Under the full suite's parallel load that
  was sometimes too little. The test file now imports the view once up
  front, so only the app's own work is timed. The list test, which waits
  for the lazily imported map in the same way, does the same.
- **Fifty favourites (not a race):** a whole-app test, about 0.8 s alone and
  1.3 to 2.2 s in normal full runs, that passed the five-second limit only
  in a run while Lighthouse was also using the machine (the suite took 25 s
  against 15 to 22). Its axe check now covers the card it is about, not the
  whole app with fifty rows. No timeout was raised and nothing is retried.

### Budgets

Initial CSS 23.0 kB raw of 24 kB (raised from 22, written up in
`check-bundle-budget.js`). A new fonts budget: 50.5 kB preloaded of 56,
50.5 of 64 in all.

### Two fixes before the merge

- **A heading focus is moved to is underlined, not boxed.** The results and
  history headings (and the map's loading note) take focus with
  `tabindex="-1"`; the full-width ring round a heading looked like
  something to press. They now get a 2 px underline in the focus colour,
  `:focus-visible` only, so after a key and not after a click.
  `check:a11y` checks both, in both themes (40 checks, from 36).
- **The mark in the dark.** The favicon SVG draws a hairline edge in
  `night-400` under `prefers-color-scheme: dark`, so the ink square reads
  on a dark tab or page. The site's CSP does not stop it: an SVG shown as
  an image keeps its own `<style>` (checked under the production headers).
  The PNG icons stay the light version.

### Verified after the merge

Pull request #9, squash-merged as `5d87272` at 06:42 UTC on 28 October
(17:42 in Sydney); production served it about a minute later.

- **On its deploy preview, in CI:** both required checks passed.
- **Production:** `pnpm check:browser` 60 of 60 (CLS 0.000 at desktop and
  phone size); `pnpm check:a11y` 40 of 40; `/api/status` healthy, 196
  API.NSW calls counted this month.
- **PageSpeed Insights**, `/?fuel=U91&query=2250`: mobile 99, 100, 100,
  100 (FCP 1.4 s, LCP 1.7 s, TBT 0 ms, CLS 0, Speed Index 3.2 s); desktop
  100, 100, 100, 100 (FCP 0.3 s, LCP 0.4 s, CLS 0).
- **The test suite under load:** in one of five local runs while a game was
  using most of the machine, two first-in-file tests (`MapSync` on a phone,
  `StationList`'s long list) passed the five-second limit. Both are whole-app
  tests of about 1.0 to 1.4 s alone, the first render in their files; they
  passed in the other runs and in CI. Left as they are: a slow machine, not
  a race.

## 2026-10-29: Round 14 (icons, alignment and the history gap, from the phone test)

The owner tested round 13 on an iPhone. Asked for as "round 13: polish";
numbered 14 here, since round 13 is the Docket redesign.

### One icon set: Tabler

**Problem:** iOS draws some text characters as coloured emoji. The
Directions arrow (↗) and the Favourite star (☆) were emoji on the phone,
in the middle of a design whose rule is one accent, used for meaning.

**Decision:** every icon-like character is an SVG icon from one set,
[Tabler Icons](https://tabler.io/icons) (MIT, `@tabler/icons-react`):
arrows, stars, ×, the fuel caret, the disclosure chevrons (in place of the
browser's own marker, also a text triangle), and the map's zoom buttons
(our own, in place of MapLibre's). The rules are in docs/design-system.md,
Icons and Alignment.

**Why Tabler:**

- **The stroke matches the type.** A 24 px grid with a 2 px round stroke,
  drawn at 1.25em: about 1.7 px beside a 13–15 px bold label, close to the
  stem of Atkinson Hyperlegible Next at 700. Plain monoline geometry, like
  Atkinson's own humanist strokes and the docket's print.
- **Not Lucide.** The owner ruled it out: it is the shadcn default and the
  set most generated UIs ship, and would make Docket look like them.
- **Phosphor** (the other candidate) looks as good, but its React package
  puts all six weights of an icon (thin to duotone) in every icon's module,
  so each costs several times its one drawing. Its regular stroke is also
  lighter (1.5 px on 24) than Atkinson bold.
- **Per-icon files.** Each Tabler icon is its own module, one path list and
  a shared 30-line component. `src/components/Icon/icons.ts` imports them
  one file each, so the build holds 12 icons and the tests never load the
  set's 6,000-icon index; an ESLint rule (`no-restricted-imports`) fails on
  any other import of the package. The per-icon files have no types of their
  own; `tabler.d.ts` gives them the type the index declares.
- **CSP:** inline SVG elements created by React, `currentColor` for stroke
  and fill, no `style` attributes, no font, no CDN, no sprite. Nothing in
  the policy changed, and `check:browser` saw no violation.

**Cost:** initial JS 342.8 kB from 339.6 (+3.2 kB raw, +1.1 kB gzipped,
inside the 350 kB budget); initial CSS 24.1 kB from 23.3, so its budget is
raised to 25 kB (written up in `check-bundle-budget.js`). The map chunk is
6 kB smaller without MapLibre's navigation control.

**Accessibility:** every icon is `aria-hidden` and `focusable="false"`.
Icon-only buttons (search toggle, Close, Clear, zoom) are 44 px squares
named in visually hidden text, with a `title` tooltip. Directions and
Favourite keep their words (the owner's call: clarity, screen readers,
speech input, translation). Favourite's star is outline, or filled when
saved, alongside `aria-pressed`. A unit test fails if any arrow, star,
cross or triangle character is rendered in the search line, a card or a
history view.

### The search line

"Change" is now a 44 px magnifier button (still named "Change search",
`aria-expanded`), outlined while the form is folded and ink while it is
open. The fuel select is laid invisibly over the fuel's name and the
caret icon, so the line is as wide as the name in Safari too
(`field-sizing` is Chromium's only). A long place ("Ethanol 94 · Port
Macquarie NSW 2444 · 10 km") used to wrap and push the button onto a line
of its own; now the place moves to a second line under the fuel when it
cannot fit beside it, the button stays at the right, and only a place too
long for its own line is cut with an ellipsis. The distance never is. The
search block needed `min-width: 0` as a grid item, or the one-line layout
widened the page.

### Alignment, at seven widths

A scripted audit at 320, 360, 390, 430, 768, 1024 and 1440 px in both
themes measured how many rows each group of controls takes, and sideways
scrolling. Found and fixed:

- **The card's actions** (the owner's report): Close dropped to its own line
  under 390 px. Close is now the × icon alone, and the buttons' side padding
  is 8 px under 360 px, so `[Directions] [Favourite] … [×]` is one row at
  every width. A new `check:browser` step fails if the three are not on one
  row at 320, 360, 390 or 430 px; against production (before this change) it
  failed at 320 and 360 and passed at 390 and 430.
- **The toolbar** under 360 px: Filters wrapped alone. Now two rows on
  purpose: List/Map across the width, then Sort and Filters.
- **"Use my location"** on a wide screen sat above the controls' row (it
  was centred on labels and controls together).

Favourites, history actions, legend and footer were already one row.

### The doubled price tag

**Finding:** in the owner's report two "236.5" tags stood side by side by
the selected station. The map's layers were not drawing one station twice
(their filters exclude the selected station from the ordinary prices, and a
test checks it). Production's snapshot has 29 pairs of stations within 60 m
of each other, some at the same prices; in Cessnock, Pearl Energy and Metro
Petroleum are 124 m apart and both sold U91 at 236.5 on 29 October. With
one selected, the other's tag sat right beside it and read as the same
station tagged twice. Reproduced on production at 390 px.

**Decision:** while a station is selected, a neighbour within 250 m at the
same price gives up its price tag (`lookalikes` in `mapData.ts`), keeping
its dot. Different prices nearby still show: they cannot be mistaken for
the selected one. The neighbour's price is one tap away and in the list.

### Map attribution

MapLibre sets 12/20 px, which on a phone was a full-width band over the
map. Now 10 px under 40rem and `--step--2` above, in Atkinson, with tight
padding: one line in the corner, still in full, as OpenFreeMap's,
OpenMapTiles' and OpenStreetMap's licences ask.

### The October history gap

**Checked (read-only, the data.nsw.gov.au CKAN API) on 29 October:** the
newest monthly file is "FuelCheck Price History September 2026", published
14 October. October's is not out, so there was nothing to backfill.

**Decision:** the gap is drawn as intentional, not as a grey block: a thin
dashed line in the muted colour from the last price before to the first
after, and "No data, 1–22 Oct" on the plot, away from the line. No
interpolated prices: the dashes carry no values and the slider moves only
over days with prices. The gap is also named in the summary over the chart,
the credit under it, and as one row in the daily table.

**Still due:** when FuelCheck publishes October (September's came on 14
October, so mid-November is likely), run
`pnpm history:backfill --months 4 --upload` with a short-lived Netlify
token, as in the README's Maintenance section, after asking the owner. The
chart then has no gap, and needs no change.

### Three fixes after review

- **The chart's key** at 320 px wrapped "its low to high" away from its
  swatch. Each swatch and its words are now one unit that wraps whole.
- **The search line** at 320 px cut the postcode ("Port Macquarie NSW
  2…") and left a gap before the distance. Now the distance comes first
  and is never cut, and only the suburb gives way: "10 km · Port Macqu…
  NSW 2444". 360 to 430 px show the whole place.
- **Names in capitals.** 130 of 2,400 names in the snapshot are all
  capitals. Title case risks respelling brands, so the words were checked
  first: METCO, TEMCO, APCO, APW, OPT, IOR and EBM are written in capitals
  in FuelCheck's careful names or brands; "SG Chambers" is initials; "YOGI'S"
  would have become "Yogi'S" under the address rule (fixed for addresses too:
  "St John's Rd"). So `formatStationName` keeps a list of known capitals,
  the capital words of a mixed-case brand, and vowel-less initials (except
  "Mt", "St" and other short forms), and only touches a name with no
  lower-case letter. It runs in the browser where answers arrive
  (`src/lib/api.ts`), as addresses are tidied in the browser, so the API
  still sends FuelCheck's own spelling. Accepted: a brand we do not know
  that spells itself in capitals ("GTORQUE PETROLEUM" becomes "Gtorque
  Petroleum"); add it to the list if one turns up.

### Also

- `private/` is in `.gitignore`: the owner keeps local files there that must
  never be committed.
- The screenshots' fixtures were recorded again from production, so the
  README's history shows the gap as drawn now.

## 2026-10-25: Baseline (updated 28 October, round 13)

The project as of `5d87272` (round 13, the redesign, pull request #9; first
written for round 10's `d6dc135`, updated for rounds 11 and 12). Future work
starts from here; this entry is the summary, and the rounds above have the
reasons.

**What it does.** Live fuel prices for NSW and the ACT, cheapest first, for
a suburb, a postcode or the visitor's rounded location, at 2, 5, 10 or 25 km.
A list and a map (MapLibre, OpenFreeMap tiles, loaded only when shown), side
by side on wide screens, a List/Map switch on phones. Without a GPU the wide
map waits for "Show the map". On the map every station's dot is always
drawn (prices make way for dots); a tap on empty map or Escape clears the
selection, and drags, pinches and double-taps do not. A one-line summary
(cheapest, average, what the difference is worth on 50 L), sort by price or
distance, brand and price-age filters, today's move per station, directions
in the phone's maps app, the nearest stations up to 100 km when nothing is in
range. Favourites on the device. Four months of daily history per station
(FuelCheck's published files joined to our own snapshots), as a chart with a
keyboard slider and a table. Light and dark themes. All state in the URL.

**How it looks.** The Docket design (round 13): a station is one line, name,
dotted leader, mono price, opening to its card; on a phone the search folds
to one line after a search and the first price is at about 230 px. Atkinson
Hyperlegible Next and Mono, self-hosted; one accent, carbon blue, for
meaning only; the map restyled in the same tokens, the cheapest price never
dropped. `docs/design-system.md` is the source of truth for the look.

**How it runs.** A scheduled function fetches every NSW price every 30
minutes (about 1,500 API.NSW calls a month against 2,500) into Netlify
Blobs, and folds a slice of history each run. The `/api` function answers
from Blobs only. Visitors never reach API.NSW.

**Security posture.**

- Strict CSP: scripts from the site plus one hashed inline script, styles
  from the site only, no frames, the map worker our own file. Referrer and
  Permissions policies, `nosniff`, `DENY` framing, COOP.
- Rate limits, both code-based rules Legacy Free allows: `/api/*` 120 a
  minute per address (in the function's config), and the whole site 600 a
  minute (in `netlify.toml`). `Netlify-Vary` cache keys, so junk parameters
  cannot force function runs. The function is reachable only at `/api/*`.
- API.NSW credentials only in the production context, scoped to functions.
  The lockout guard stops after one refusal (or two unknown outcomes), fails
  closed, and is reset only by a person (`pnpm auth:reset`). Every call is
  counted; only retryable failures return 502.
- `main` protected (pull request, CI and the browser checks, no force
  pushes, no bypass), squash
  merges, Dependabot alerts and updates, private vulnerability reporting,
  secret scanning with push protection, actions pinned to commits,
  `minimumReleaseAge` a day. No open alerts or pull requests at the
  baseline.
- No cookies, analytics or tracking; position rounded to about 1 km and never
  stored; privacy note at `/privacy.html`.

**Monitoring.**

- `/api/status`: snapshot age, the last run, read errors and API.NSW calls
  this month (196 counted by 28 October since 24 October 09:30 UTC, plus
  about 70 before that). A 503 when anything is wrong or calls pass 2,000.
- UptimeRobot on `/api/status` every 15 minutes, emailing the owner.
- Netlify's usage emails at 50, 75, 90 and 100% of each plan limit.
- The API.NSW dashboard, the authority on the quota.
- CI on every pull request: typecheck, lint, format, 646 tests, the build
  and bundle budgets (JS, CSS and fonts); and `pnpm check:browser` (60
  checks, including CSP, CLS at desktop and phone size and touch gestures on
  the map) and `pnpm check:a11y` (40) against its deploy preview, about two
  minutes. Both required. The same checks by hand against production.
- PageSpeed Insights, a results page: desktop 100, mobile 99, CLS 0, and 100
  for accessibility, best practices and SEO (28 October, after round 13).
  The desktop machine has no GPU, so it measures the "Show the map" page:
  the page a GPU-less visitor gets, not the map drawn faster. Visitors with
  a GPU see what they saw before (round 11).

**Known accepted risks.**

- **One limit pauses 16 sites.** On Legacy Free, reaching any non-build limit
  (bandwidth is account-wide) pauses every site on the account until it is
  upgraded. Moving the site to its own team was rejected: new teams are on
  credits.
- **Per-address limits only.** Many addresses together are not limited. One
  address at the static limit could still pull about 37 GB an hour of the
  1 MB map chunk, so the month's 100 GB in under three hours; the usage
  emails are the warning.
- **The site-wide limit also counts `/api` requests** (Netlify cannot exclude
  a path); harmless below 480 other requests a minute.
- **Netlify's bot challenge** can answer heavy automated use from one address
  with a 403 before our limits do; no real visitor comes near it.
- **Deploy previews share production's Blobs store.** They only read it, and
  the snapshot job does nothing on a preview or branch deploy.
- **The history backfill and `auth:reset` need an account-wide Netlify
  token**; use a short-lived one made for the job and delete it after.
- `callsite` shows an unknown licence (its Readme says MIT).
- Product limits: NSW and the ACT only, as fresh as retailers report plus up
  to 30 minutes, "today" against our own snapshots, ABS 2021 suburbs, the
  map needs WebGL.
- **Without a GPU the wide map waits to be asked.** A visitor whose browser
  draws WebGL in software presses "Show the map" once a visit, in exchange
  for a page that is usable at once. Software is recognised by the
  renderer's name; a browser that hides it (no debug extension, Firefox's
  fingerprinting protection) gets the map at once and its slow first draw,
  as before.
- **The desktop PageSpeed score depends on that detection.** Google's
  machine is GPU-less and takes the button path. If a future Chrome hid the
  renderer there too, the score would drop back to about 68 with nothing
  wrong on the site.
- **The browser checks depend on Netlify's commit status.** If Netlify posts
  none (a fork's pull request it does not build, an outage), the check fails
  after 15 minutes rather than passing untested: rerun it, or merge by hand
  after checking the preview. Netlify's bot protection could one day
  challenge GitHub's runners; the check would fail, not pass.
- **Fewer prices in a dense map view** (round 12): a price that would cover
  any station's dot is dropped, and zooming in shows the rest. The cheapest
  is the exception (round 13): it is never dropped, so in a very dense spot
  it can sit partly over neighbouring dots.
- **A slow machine can time out a whole-app test.** The first test in a
  file renders the whole app cold (about 1 to 1.4 s alone); under heavy
  local load that has passed five seconds. CI has not seen it.
- **A tap on empty map clears the selection 300 ms later**, so a double-tap
  can zoom without clearing it. A double-tap slower than that both zooms and
  clears. A tap within 12 px of a dot picks that station instead, so in a
  very dense spot Escape or Close is the surer way.
- `--badge-clearance` still keeps 4 rem clear for Netlify's badge, which is
  no longer served; harmless spacing, kept in case it returns.

**Open maintenance items.**

- **When FuelCheck publishes October 2026** (not out on 29 October; likely
  mid-November): run `pnpm history:backfill --months 4 --upload`, after
  asking the owner, to fill 1–22 October. Until then the chart shows the gap
  as a dashed line with "No data, 1–22 Oct" (round 14).
- **November 2026:** `/api/status`'s call count covers the whole month from
  then on; until then the API.NSW dashboard is the authority for October.
- **Optional:** see our 429 on production once Netlify no longer challenges
  the test address; space bursts out and keep them short.
- Then: watch the quota and Netlify's usage page; merge Dependabot's pull
  requests through CI; a backfill once a quarter if a longer chart is wanted.
