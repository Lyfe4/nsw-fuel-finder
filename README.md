# NSW Fuel Finder

Live fuel prices for New South Wales and the ACT, cheapest first for the fuel
you use, on a list and a map, with four months of daily price history.

**[nsw-fuel-finder.netlify.app](https://nsw-fuel-finder.netlify.app)**

<p>
  <img src="docs/screenshots/desktop-light-results.png" alt="The results for postcode 2250: nineteen stations cheapest first beside a map of their prices." width="66%" />
  <img src="docs/screenshots/phone-dark-map.png" alt="The same search on a phone in dark mode, on the map." width="22%" />
</p>

A portfolio project about live data, built as a deliberate contrast to
[Patchbay](https://github.com/Lyfe4/toolbox), a developer toolbox that never
touches the network. Here everything depends on someone else's API, quota and
uptime, and the interesting work is making that dependable.

| Phone, light                                                              | Phone, dark                                                                    | Price history                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| ![Results as a list on a phone](docs/screenshots/phone-light-results.png) | ![Results as a list on a phone, dark](docs/screenshots/phone-dark-results.png) | ![A station's daily price chart](docs/screenshots/phone-light-history.png) |

## How it works

```mermaid
flowchart LR
  nsw["API.NSW Fuel API<br/>(2,500 calls a month)"]
  fc["FuelCheck monthly history<br/>data.nsw.gov.au, CC BY-SA"]
  subgraph netlify["Netlify"]
    job["snapshot function<br/>scheduled, every 30 min"]
    blobs[("Netlify Blobs<br/>snapshot · daily history<br/>per-station history")]
    api["api function<br/>/api/*"]
    site["React app<br/>static, on the CDN"]
  end
  script["pnpm history:backfill<br/>(run by hand)"]
  tiles["OpenFreeMap<br/>vector tiles"]
  browser(["Browser"])

  nsw -->|"1 call a run"| job
  job -->|"snapshot, then a slice<br/>of history"| blobs
  fc --> script -->|"once"| blobs
  blobs --> api
  browser -->|"search, favourites,<br/>history"| api
  browser --> site
  browser -->|"map, when shown"| tiles
```

Visitors never reach API.NSW. A scheduled function fetches every NSW price
every 30 minutes into Netlify Blobs, and the `/api` function answers searches
from that snapshot, held in memory by a warm instance.

## Key decisions

The full log, with what else was considered and the evidence behind each
choice, is in [docs/decisions.md](docs/decisions.md).

**A snapshot, so visitors cannot spend the quota.** API.NSW allows 2,500 calls
a month and locks the account after three failed sign-ins. A proxy calling it
per search would let one bot or one busy evening use up the month and break the
site for everyone. Instead the call count is a constant set by the schedule:
about 1,500 a month, whatever the traffic. The trade-off is freshness. A price
can be up to 30 minutes older here than on FuelCheck, though in practice most
prices are days old because retailers change them that rarely. A guard stored
in Blobs stops the job before a third failed sign-in, and `/api/status`
reports, in plain English, any gap between what the job wrote and what the
API serves. A stall of exactly that kind happened once, and is written up in
the log.

**Accessibility as a requirement, not a pass at the end.** Native controls
wherever they fit: the fuel, distance and theme pickers are `<select>`s, which
every phone already knows how to show. Where a custom widget was needed (the
suburb search), it is Downshift's WAI-ARIA combobox, with its two
screen-reader gaps fixed and tested. Every action that removes its own button
says where focus goes next. The map's dots are not focusable; the list is the
keyboard path, because 500 Tab stops in map order would mean nothing. The
price chart is a slider over the days, with the summary in words and every
value in a table. axe runs in the unit tests in both themes, and against the
real site with its contrast rule on.

**Colour is never the only signal, and the colours survive colour blindness.**
The map's price bands were green, amber and red, which with deuteranopia are
nearly one colour. They are now blue, grey and orange, and a test simulates
three kinds of colour blindness and fails if any two bands come within ΔE 20.
The cheapest stations also say "Cheapest" in words, and old prices are
flagged in text.

**A map that costs nothing until it is shown.** MapLibre draws OpenFreeMap's
vector tiles with no key or account, and drops overlapping labels so a 25 km
Sydney search stays readable. It is also about 430 kB gzipped, more than the
rest of the app together. So it is a separate chunk, fetched only when a map is
on screen: a phone showing the list never downloads it. Its style, tile index
and fonts are fetched while it downloads. Bundle budgets in CI hold the first
load to its current size and give the map its own ceiling.

**Four months of history from day one, by joining open data to our own.**
API.NSW has no history, so the job keeps a daily low, high and last price from
launch. The months before launch come from FuelCheck's published monthly files,
which list every price change but have no station codes. Stations are matched
by address, then by name within the postcode, and anything ambiguous is left
out rather than guessed: 99.2% of price changes matched. The chart reads two
small per-station files, which the scheduled job keeps up to date 200 stations
a run.

**No router, no state library.** The screen's state is its search, so it lives
in the URL (`?fuel=U91&query=2250&radius=10&history=972`), which makes every
view shareable and makes Back undo a search or close a station's history.
TanStack Query holds what the API said. A router was reconsidered when the
history view arrived and still was not worth a dependency for one URL
parameter.

**Locked down where it matters.** A Content-Security-Policy allows scripts
only from the site itself plus two inline scripts by exact hash: our
no-flash theme script, and Netlify's free-plan badge. Inline styles are
allowed, because the badge writes the window size into its stylesheet and no
hash can match that. The map's worker is our own file, so it needs no `blob:`.
The browser check fails on any policy violation.

## Known limitations

- **NSW and the ACT only.** That is what FuelCheck covers.
- **As fresh as retailers report.** Stations must report a change within 30
  minutes, and the snapshot adds up to 30 more. A price untouched for 14 days
  or more is flagged.
- **History has a gap from 1 to 22 October 2026.** The published history
  currently ends on 30 September, and our own starts on 23 October. The gap is
  shaded "No data" until FuelCheck publishes October (see Maintenance).
- **Suburbs are found by the ABS's 2021 boundaries**, so a suburb created or
  renamed since then is found only by postcode.
- **The map needs WebGL.** Without it the list still has every station.

## Running it locally

You need Node 22 and pnpm 11 (`corepack enable`), and for the live data an
API.NSW account with access to the Fuel API.

```bash
pnpm install
cp .env.example .env      # then fill in FUEL_API_KEY and FUEL_API_SECRET
pnpm dev                  # the app alone, at http://localhost:5173
pnpm dev:netlify          # the app and the functions together, at :8888
```

> **Careful with the snapshot job.** Running it locally
> (`netlify functions:invoke snapshot`) makes real API.NSW calls from the same
> monthly quota production uses. Three failed sign-ins in a row lock the
> account. The job's guard stops after two, but a typo in `.env` still counts.
> Nothing else here calls API.NSW. On Windows, `netlify dev` needs Developer
> Mode on.

| Command                  | What it does                                                                |
| ------------------------ | --------------------------------------------------------------------------- |
| `pnpm test`              | Unit and integration tests (Vitest, Testing Library, axe), no network       |
| `pnpm typecheck`         | TypeScript across the app, functions and config                             |
| `pnpm lint`              | ESLint, including jsx-a11y and type-aware rules                             |
| `pnpm build`             | The production build                                                        |
| `pnpm bundle:check`      | Bundle budgets, after a build                                               |
| `pnpm check:browser URL` | Real-browser smoke check (Playwright): search, map, history, CSP violations |
| `pnpm check:a11y URL`    | axe with colour contrast in both themes, first paint, five screen sizes     |
| `pnpm serve:headers`     | The build with production's security headers, to test a CSP change first    |
| `pnpm screenshots`       | These screenshots and the social card, from committed fixtures              |
| `pnpm history:backfill`  | Rebuild history from FuelCheck's monthly files (`--upload` writes to Blobs) |

CI runs typecheck, lint, format, tests, build and the bundle budget on every
push. The browser checks need a running site, so they are run by hand against
`netlify dev` or production.

## Maintenance

- **Early November 2026:** FuelCheck publishes October's history. Run
  `pnpm history:backfill --months 4 --upload` to fill the 1-22 October gap
  (it needs `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`, and writes to
  production Blobs). Then once a quarter, or whenever a longer chart is wanted.
- **If prices look stuck**, open `/api/status` first, then
  `netlify logs --function snapshot`.
- **If the Netlify badge stops drawing** (the smoke check reports a CSP
  violation), Netlify has changed it: update its hash in `netlify.toml`.
- **Keep watching the quota** on the API.NSW dashboard, about 1,500 calls a
  month at this schedule, and Netlify's usage page: the team's sites share its
  Legacy Free limits.

## Data and licences

- **Live prices:** [NSW Government FuelCheck](https://www.fuelcheck.nsw.gov.au/)
  via the API.NSW Fuel API, under its terms of use.
- **Price history** before 23 October 2026:
  [FuelCheck price history](https://data.nsw.gov.au/data/dataset/fuel-check),
  © NSW Fair Trading, [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).
  The daily low, high and last prices derived from it (and from our own
  snapshots) are shared under **CC BY-SA 4.0**, and credited wherever shown.
- **Suburbs and postcodes:** Australian Bureau of Statistics,
  [ASGS Edition 3](https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3)
  (2021), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), built by
  `scripts/build-gazetteer.js`.
- **Map:** [OpenFreeMap](https://openfreemap.org/) tiles,
  © [OpenMapTiles](https://openmaptiles.org/), data ©
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, drawn
  with [MapLibre GL JS](https://maplibre.org/).
- **Code:** [MIT](LICENSE).
