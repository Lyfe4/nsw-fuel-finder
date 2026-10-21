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

**Decision:** `shared/fuelTypes.ts` lists the codes. Unknown codes are a 400.
**Why:** validating against live `/lovs` would mean a 2 MB fetch on each cold
start, and a quota call each time. The codes have been stable since 2016.
The list is still to be checked against live `/api/reference`.

### Upstream failures are 5xx, never passed through

**Decision:** status mapping:

- An upstream 401 is a 502 `upstream_auth`.
- An upstream 4xx is a 502 `upstream_error`.
- 5xx or a network failure is a 503, with `Retry-After`.
- A timeout is a 504.
- Errors are never cached.

**Why:** the browser cannot fix our credentials or our request format.
Passing a 401 or 400 through would point at the wrong party.

### Back off after rejected credentials

**Decision:** after the token endpoint refuses our credentials, the
function does not call it again for five minutes (per instance).
**Why:** API.NSW's terms deny access after three consecutive failed
identifications. Without a backoff, every visitor's request would be
another failure, and a typo in an env var could lock the account.

### Token cache in module scope, per instance

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
