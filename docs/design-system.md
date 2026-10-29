# Design system: Docket

The source of truth for how Fuel Finder looks and behaves on screen. It
describes the minimal Docket direction the owner chose in October 2026
(mockups and the reasoning behind them in `docs/design-directions/`,
starting with `minimal/README.md`). When this file and the code disagree,
one of them is a bug. Fix the code, or change this file in the same pull
request.

## The idea

A servo docket. A strip of thermal paper torn off once at the top,
monospaced figures, a dotted leader from each station to its price. The
price is the hero of every screen, and everything else is as quiet as it
can be while still being there. **Only what the screen needs is on it.**
Everything else is one step away, and the step is the same for everyone:
keyboard, touch, screen reader.

Nothing in the identity says "NSW". The region is content ("NSW · ACT"),
so another state is a data change, not a rebrand.

## Rules that decide arguments

1. **Hierarchy from type size, weight and space first, then rules. Colour
   and boxes last.** Rules are dividers. The one container is the docket strip.
2. **One accent, carbon blue, used only for meaning:** the cheapest price, a
   price that moved today, the chart's cursor. Never for links, buttons or
   decoration.
3. **Colour is never the only signal.** "Cheapest", "Old price" and "down
   1.0 today" are words. The map's bands also have prices beside them, and
   the list has every station.
4. **Every number is tabular and lining.** Prices are set in the mono face
   and line up on the decimal.
5. **Decoration, exactly this much:** one torn edge (the top of the docket
   strip, light theme only: on the dark counter it read as a smudge), dotted leaders (station row, map card, every-fuel list, history),
   dashed rules between docket sections. Nothing else: no torn bottom,
   perforations, paper texture, halftone, shadows, barcodes or receipt
   furniture ("TAX INVOICE", docket numbers, "THANK YOU").
6. **Letter-spaced capitals only for the wordmark.** Labels are sentence
   case.
7. **Decoration is hidden from assistive technology** (`aria-hidden`):
   leaders, `·` and every icon. Words carry the meaning, on screen or in
   visually hidden text.
8. **No text characters as icons.** Arrows, stars, crosses, carets and
   disclosure triangles are SVG icons from the one icon set (Icons, below):
   iOS draws characters like the north-east arrow and the white star as
   coloured emoji.

Banned outright (from the brief): Inter, Geist, Space Grotesk, DM Sans,
Poppins, Plus Jakarta Sans, Satoshi, Instrument Serif or system-ui as the
brand face; purple, indigo or violet; gradients, gradient text, glass,
glows and blobs; a card with a soft shadow per item; uniform radius
everywhere; pill badges; emoji or a decorative icon set; a centred hero
stack; teal or emerald; fade-up-on-scroll, springs, hover scale; the
grey-50 page with white cards. Icons are allowed only as the functional
set described below (never decoration), and never Lucide: it is the
default set of shadcn and most generated UIs, and would make Docket look
like them.

## Colour

Tokens live in `src/styles/tokens.css`. Primitives (`--palette-*`) are the
only place a colour value is written. Components use semantic tokens only,
and `tokens.test.ts` fails otherwise. Dark mode re-points every semantic
colour under `[data-theme='dark']`.

| Semantic token                   | Job                                              | Light                         | Dark                          |
| -------------------------------- | ------------------------------------------------ | ----------------------------- | ----------------------------- |
| `--color-bg`                     | The counter: the page behind the docket          | `#e8e5dc`                     | `#0e0f11`                     |
| `--color-surface`                | The docket's paper; cards, inputs                | `#fbfaf6`                     | `#17181b`                     |
| `--color-text`                   | Ink                                              | `#1c1c1a`                     | `#edebe4`                     |
| `--color-text-muted`             | Secondary text: distance, age, hints             | `#58564f`                     | `#a8a59c`                     |
| `--color-border`                 | Quiet rules between rows (decorative)            | `#8e8b83`                     | `#5c5a55`                     |
| `--color-border-strong`          | Control borders (3:1, WCAG 1.4.11)               | `#7a776f`                     | `#7d7a73`                     |
| `--color-ink` / `--color-on-ink` | Primary buttons, the pressed List/Map switch     | text / surface                | text / surface                |
| `--color-accent`                 | Meaning only: cheapest, moved, the chart cursor  | `#1f55a8`                     | `#86b4f0`                     |
| `--color-on-accent`              | Text on the accent (the cheapest map tag)        | `#fbfaf6`                     | `#17181b`                     |
| `--color-focus`                  | Focus ring                                       | accent                        | accent                        |
| `--color-warning`                | Old prices: ink, bold, in words                  | ink                           | ink                           |
| `--color-danger`                 | Errors                                           | `#a3261a`                     | `#ff9480`                     |
| `--color-price-low/mid/high`     | Map bands, cheapest third to dearest             | `#1f55a8` `#77736a` `#a4520c` | `#86b4f0` `#9c988e` `#f0954a` |
| `--color-map-*`                  | Basemap land, water, shore, parks, roads, labels | see the map section           |                               |

Measured contrast (WCAG 2.2): text on surface 16.3:1 light and 14.9:1 dark;
muted on bg 5.8 and 7.8; accent on surface 6.9 and 8.3; control borders
4.3 and 4.2. All three bands are at least 3.5:1 on every map ground. The
smallest band difference under protanopia, deuteranopia or tritanopia is ΔE
29.7 (the test asks 20). `tokens.test.ts` checks all of this in both themes.

`theme-color` (the browser's own chrome): `#e8e5dc` light, `#0e0f11` dark.

## Type

Two faces from one superfamily, both by the Braille Institute, designed
for low-vision readers, SIL Open Font License 1.1, self-hosted:

- **Atkinson Hyperlegible Next** (variable, wght 200–800), `--font-text`:
  everything that is words.
- **Atkinson Hyperlegible Mono** (variable, wght 200–800), `--font-figures`:
  prices, the docket's money, the wordmark. Fixed width, so prices align
  with no OpenType features. Both faces draw a slashed zero. That's part of
  the low-vision design, and there is no feature to turn it off.

Files: `public/fonts/atkinson-next-latin.v1.woff2` (34 kB) and
`public/fonts/atkinson-mono-latin.v1.woff2` (18 kB), Latin subsets from
fontsource 5.3.0, with their licence beside them. Both are preloaded with
`crossorigin` (the wordmark is mono, so the first paint needs both),
`font-display: swap`, and cached for a year. A changed file gets a new `vN`.

**No layout shift on swap.** Each face has a local fallback face with
metric overrides, so the fallback takes the same room:

| Fallback    | For  | size-adjust | ascent | descent | line-gap |
| ----------- | ---- | ----------- | ------ | ------- | -------- |
| Arial       | Next | 99.8%       | 98.6%  | 31.7%   | 0%       |
| Courier New | Mono | 105.3%      | 93.4%  | 30%     | 0%       |

Measured with fontTools: average advance over English text, and hhea
metrics. Safari before 17 ignores the overrides, and a phone without Arial
(Android) falls back to its own sans with no overrides. The browser check's
CLS test runs in Chromium.

**Scale** (Utopia, 320 → 1440 px, ratio 1.2 → 1.25, base 16 → 18 px):

| Token       | Size     | Used for                             |
| ----------- | -------- | ------------------------------------ |
| `--step--2` | 11–12 px | Map attribution, licence credit      |
| `--step--1` | 13–15 px | Secondary lines, labels, row actions |
| `--step-0`  | 16–18 px | Body, station names                  |
| `--step-1`  | 19–23 px | Row prices, history heading          |
| `--step-2`  | 23–28 px | Map card price                       |
| `--step-4`  | 33–44 px | Today's price in the history view    |

Weights: 400 regular, 700 bold (names, labels), 800 for prices. Line
height 1.4 for text, 1.15 for headings.

## Space, rules, shape

- Spacing: a 4 px scale, `--space-1` … `--space-6` = 4, 8, 12, 16, 24 and 32
  px.
- Rules: `1px dashed --color-border` between rows; `1.5px dashed
--color-text` between docket sections; `1.5px solid --color-text` under
  the masthead. The dotted leader is `2px dotted --color-border`.
- Radius: `--radius` 3 px, on controls only. The docket strip and the map
  have square corners.
- Focus: `2px solid --color-focus`, 2 px offset, on every control. On the
  station row, the ring is drawn inside the row (offset -2 px), so it isn't
  clipped by the list. A heading or note the app moves focus to
  (`tabindex="-1"`: the results and history headings, the map's loading
  note) is underlined instead, 2 px in `--color-focus`, so it doesn't look
  like something to press. Both are `:focus-visible` only: they show after
  a key, not after a click or a tap.
- Touch targets: at least 44 × 44 px (`--target-size`), except inline text
  buttons, which are at least 24 px high (WCAG 2.5.8) with space around them.

## Icons

**One set: [Tabler Icons](https://tabler.io/icons) (MIT), outline.** A 24 px
grid, a 2 px stroke with round caps and joins, drawn at 1.25em: next to a
13–15 px bold label that is a stroke of about 1.7 px, close to the stem of
Atkinson Hyperlegible Next at 700, so icon and word read as one weight.
Plain geometric strokes, no two-tone or duotone, which suits a thermal
print. Why Tabler and not the others is in docs/decisions.md (round 14).

**How they get in.** `src/components/Icon/icons.ts` imports each icon from
its own file (`@tabler/icons-react/dist/esm/icons/IconX.mjs`) and names it
by its job (`Close`, `NewTab`, `Disclosure`). Nothing else imports the
package: an ESLint rule fails the build otherwise. Each is inline SVG in the
JavaScript: no icon font, no CDN, no external sprite, nothing the CSP has to
allow. `stroke="currentColor"`, so they take the text's colour in both
themes; the one filled icon (the saved star) is `fill="currentColor"`.

**`<Icon icon={…} />`** draws one: `aria-hidden`, `focusable="false"`,
1.25em square, never shrinking in a row. **`<IconButton>`** is an
icon-only button: a 44 × 44 px square, its name in visually hidden text
(translated with the page, read by every screen reader) and a `title` for
a tooltip under a pointer.

| Job              | Icon                       | Where                                                   | With words?     |
| ---------------- | -------------------------- | ------------------------------------------------------- | --------------- |
| `Search`         | search                     | The folded search line's toggle                         | No              |
| `Close`          | x                          | The station card's Close; the place box's Clear         | No              |
| `ZoomIn`/`Out`   | plus, minus                | The map                                                 | No              |
| `NewTab`         | arrow-up-right, after word | Directions (card and history)                           | Yes, always     |
| `Star`           | star / star-filled         | Favourite: outline, filled when saved (`aria-pressed`)  | Yes, always     |
| `Caret`          | chevron-down               | The folded line's fuel picker                           | The fuel's name |
| `Disclosure`     | chevron-right, turns down  | Every `<details>` summary (`<Summary>`), not the marker | Yes             |
| `Back`           | arrow-left                 | Back to results                                         | Yes             |
| `ArrowUp`/`Down` | arrow-up, arrow-down       | Today's move ("2.0 today")                              | Yes             |

**Icon alone only where everyone reads it the same way**: close, clear,
zoom, search. Anything else keeps a short word beside it (Directions,
Favourite), for clarity, for screen readers and speech input (the visible
word is the name), and for translation. The legend's "Centre" ring is not
an icon: it is drawn as the map draws the search origin, so the key matches
the map.

## Alignment

Every row of controls is one row on purpose at every width from 320 to
1440 px, in both themes, or breaks in one planned place:

- **Search line (phone, folded):** fuel and place on one line when they
  fit; otherwise they move under the fuel. The search button stays at the
  right, centred on both lines. Never three lines; a place too long even for
  its own line ends its suburb in an ellipsis and keeps "NSW 2444"; the
  distance is never cut.
- **Search form (wide):** "Use my location" sits on the controls' row, not
  centred on labels and controls together.
- **Toolbar:** one row from 360 px. Under 360 px, two rows on purpose:
  List/Map across the width, then Sort at the left and Filters at the right.
- **Station card:** `[Directions] [Favourite] … [×]` on one row at every
  width; under 360 px the buttons' side padding drops from 12 to 8 px so
  they fit. `check:browser` fails if the three are not on one row at 320,
  360, 390 or 430 px.
- **Keys and legends:** each swatch and its words are one unit that wraps
  whole (the price chart's key at 320 px: two lines, each with its swatch).
- **History actions, favourites rows, legend, footer:** one row (the map's
  legend from 320 px); a long station name in a favourite wraps, its Remove stays
  under it at the left.
- Nothing scrolls sideways at any width (also in `check:browser`).

## Components

### Masthead

One line: the wordmark "FUEL FINDER" (mono, 800, letter-spaced caps)
at the left, "NSW · ACT" (muted) at the right, then a 1.5 px rule. The
`<h1>` is "Fuel Finder".

### Search

- **Before a search, and from 60rem at all times:** the form, with visible
  short labels only: Fuel, Within, Suburb or postcode. Search (primary) and
  "Use my location" (a text button). No hints or helper text. On wide
  screens it is one row.
- **On phones after a search:** one line in place of the form:
  `Unleaded 91 (caret)  5 km · 2250  [search]` (a long place on a second
  line, see Alignment).
  - The fuel is a native `<select>`, named "Fuel", laid invisibly over the
    fuel's name and the icon set's caret, so the line is exactly as wide as
    the name in every browser and a tap anywhere on it opens the phone's
    picker. The focus ring is drawn round what is on show. Changing it
    searches again at once, as the form's select does.
  - **The search button** is the magnifier alone, a 44 px disclosure button
    named "Change search" (`aria-expanded`, `aria-controls` the form,
    tooltip "Change search"). Closed it is outlined; open it is filled ink,
    like the pressed List/Map switch. Opening keeps focus on it, so the next
    Tab is the form. A successful search closes the form and moves focus to
    the results heading. A failed one ("no such place") keeps it open with
    focus in the place field, and the error announced.
  - The distance and place are text (they are the search button's
    context), distance first: it is short and never cut. A place too long
    for its line loses the end of its suburb, never its state and postcode:
    "10 km · Port Macqu… NSW 2444" at 320 px.

### Favourites

A `<details>` "Favourites 3" line, hidden entirely when there are none.
Open by default when there is no search, as now. Rows use the station-row
anatomy (name · leader · price, age underneath) and keep a quiet Remove.

### Results heading and summary

One line at the top of the docket. "19 stations" (the visible part of the
`<h2>`; the rest, "within 5 km of postcode 2250", is visually hidden so the
heading keeps its full name), and at the right "save **$3.02** on 50 L".
The full sentence ("Cheapest 233.9, average 239.9 cents a litre. Filling 50
litres…") is visually hidden. The time of the prices sits after the list
("Unleaded 91 prices as of 6:00 pm, from FuelCheck"). The stale-prices
notice appears at the top only when prices are old.

### Tools

One row, between dashed rules: the List/Map switch (phones only), Sort
(a native select with a visible label, options "Cheapest" and "Nearest"),
and Filters (a disclosure; its summary adds what is in force, "Filters:
BP", only when a filter is on). Open, the filters take a row of their own.
On a 390 px phone the row fits on one line and the first price sits at
about 231 px (292 px with a favourites line). On wide screens the
heading, the saving and the toolbar keep to the list's column.

### Station row

```
Metro Petroleum Gosford ··········· 233.9
3.4 km · 21 hours ago            Cheapest
```

- `<li><h3><button aria-expanded aria-controls>`: the WAI-ARIA accordion. One
  Tab stop per station, and heading navigation still goes station by
  station. The button's accessible name is the whole row as one sentence:
  "Metro Petroleum Gosford 233.9 cents a litre, cheapest, 3.4 km away,
  updated 21 hours ago" (visually hidden commas and words).
- Line 1: name (700) · dotted leader · price (mono 800, `--step-1`; the
  accent when cheapest). Line 2: distance · age (muted), and at the right
  "Cheapest" (accent, 700) when it is. An old price replaces the age with
  **"Old price, 16 days ago"** (ink, 800).
- Pressing it selects the station (in the URL, as now), opens its card
  directly under it, and closes any other. On a wide screen the map flies to
  it. Pressing it again, Close, or Escape in the card deselects it, and focus
  returns to the row.
- A long name wraps, and the leader and price sit on its last line.

### Station names

FuelCheck has about 130 of 2,400 names in capitals ("MOBIL HASTINGS
RIVER"). The browser sets those in title case where answers come in
(`src/lib/api.ts`, `formatStationName`), so every place a name is shown
or read out agrees. Only a name with no lower-case letter is touched.
Kept in capitals: known brands and initials (BP, EG, OTR, OPT, APW, METCO
and others in `format.ts`), any word the station's brand writes in
capitals beside lower case ("TEMCO Petroleum"), and words with no vowel
("SG Chambers", "PK's"), except short forms like "Mt" and "St". A
possessive stays small ("Yogi's").

### Station card

Under its row in the list, at every width: brand · address (an
all-capitals address set in title case in the browser, and an all-capitals
name too, brand capitals kept (Station names, below); a capitals suburb
in an otherwise careful address given the ABS gazetteer's spelling in the
API), "down 1.0
today" when it moved, a "Price history" link, then one row of actions:
Directions (primary button with the new-tab arrow, opens the phone's maps
app), Favourite (bordered, a star that is filled when saved, `aria-pressed`)
and, at the far end, Close as the × icon alone ("Close, <station>").

On a phone in Map view, the same card sits under the map, with the station
name and the price on a leader line at the top. It has no "List" button.

### Map

OpenFreeMap's tiles, drawn in our colours (`src/features/map/basemap.ts`
restyles their style at every `style.load`, so there is no style file of
our own to keep in step): paper land (`--color-map-land`), parks a shade
off it, plain pale water with a shore line, roads as outlines (major roads
in ink, minor ones faint, the road itself paper), and no buildings, points
of interest or house numbers. Labels stay in OpenFreeMap's Noto Sans: our
own glyphs would cost about 250 kB of PBFs and our bandwidth for little
gain in this direction (docs/design-directions/README.md).

Prices are boxed tags: paper with an ink edge, the cheapest inverted in
the accent, the selected one with a heavier edge. **One tag by the selected
station:** a neighbour within 250 m at the same price gives up its price
(not its dot) while that station is selected, because two equal tags side
by side read as one station tagged twice (Cessnock, round 14).

**Controls:** our own zoom buttons (the icon set's plus and minus, 44 px,
in the top-right corner), not MapLibre's 29 px ones. **Attribution:** in
full, as the tiles' licences ask, but in proportion: 10 px on a phone,
`--step--2` from 40rem, one line in the bottom-right corner, clear of the
zoom buttons and the legend (which is under the map). The tag is fitted to its
price and takes no part in placement itself, so a price is placed (or
dropped to make way for a dot) exactly as before. Dots stay on top.

**The cheapest price is never dropped.** It has a layer of its own,
placed right after the selected price and before every other, so the
others make way for it; it tries eight places beside its dot and, if every
one would cover another dot, overlaps as a last resort (the dots are still
drawn over it). Ties all show.

The legend, under the map, is the docket's scale bar on one line from
320 px: "Cheapest 233.9 [blue | grey | orange] 254.9 Dearest (ring)
Centre". The bands are thirds by rank, not by price. Screen readers get the
whole key as a sentence.

### History

Back to results; the station name (`<h2>`, "Price history: …" for screen
readers); today's price (mono, `--step-4`) with "cents a litre of Unleaded
91 now, updated 21 hours ago"; Directions and Favourite as quiet text links
(a shared history link has no results behind it); the lowest/highest line;
the chart with its day readout; "Every fuel here now" and "Daily prices as
a table" as disclosures; one small licence line. **On wide screens**, "Every
fuel here now" moves to a right-hand column and is open by default, so the
chart keeps a comfortable width and the right half isn't empty.

The chart is a thermal print: an ink trace of the day's last price, the
low–high range as a pale band, quiet gridlines, mono axis labels, and the
slider's day as a dotted accent cursor.

**Missing days** are drawn as a thin dashed line in the muted colour from
the last price before to the first after, so the trace is not cut off as
if broken, with a note "No data, 1–22 Oct" at the top or bottom of the plot
(whichever is further from the dashes) on a halo of paper. The dashes are
plainly not the ink trace and carry no values: the slider moves only over
days with prices, and nothing is interpolated. A gap of one or two days
gets the dashes alone. In words, every gap is in the summary over the
chart ("No data for 1 Oct 2026 to 22 Oct 2026."), in the credit under it,
and as one row in the daily table ("1–22 Oct, No data") where it falls.

### Buttons and links

- Primary: ink background, paper text, 3 px radius, 40–44 px high.
- Secondary: 1.5 px ink border, transparent.
- Text button and link: ink, underlined (1 px, offset 3 px). Row and card
  actions use the muted colour with an underline in `--color-border`.
- No hover colour changes beyond the underline thickening. No hover scale.

### Notices

Errors are a sentence in `--color-danger` with the action button under it.
No tinted box. `role="alert"` as now. Old prices are a sentence in ink, bold.

### Footer

Small muted type: the data credits (all of them; licences require them),
the theme select (a labelled native select), and Privacy.

### The mark

A torn docket on an ink square, with two ink lines and one carbon-blue line
(`scripts/generate-icons.mjs`, colours from the tokens). In a dark browser
or on a dark page the SVG adds a 1-unit hairline edge in `night-400`, so the
square still reads against the dark instead of leaving a loose scrap of
paper. The PNGs (old browsers, home screens) are always the light version.

## Motion

Only to explain a change of state: the list re-sorting (existing FLIP, 200
ms), a card opening (height and opacity, 180 ms), the map flying to a
station (MapLibre's own). Ease-out, 150–250 ms. All of it is off under
`prefers-reduced-motion`, as `global.css` already enforces.

## Budgets

- Initial CSS: 25 kB raw (24.1 kB at round 14). Raise it only in a commit
  that says why, with the note in `scripts/check-bundle-budget.js`.
- Icons: in the initial JavaScript (12 icons, about 2 kB), inside its
  unchanged 350 kB budget, which would also catch the set's whole index
  slipping in.
- Fonts (`pnpm bundle:check`): every preloaded font together at most 56 kB,
  all files in `public/fonts/` at most 64 kB, and every preload must point at
  a file that exists.
- CLS 0 in `check:browser`, and PageSpeed held at the round 11 baseline.
