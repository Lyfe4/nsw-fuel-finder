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
7. **Decorative characters are hidden from assistive technology**
   (`aria-hidden`): leaders, `·`, `↗`, `☆`/`★`, `↓`/`↑`, `←`. Words carry the
   meaning in visually hidden text where the character did.

Banned outright (from the brief): Inter, Geist, Space Grotesk, DM Sans,
Poppins, Plus Jakarta Sans, Satoshi, Instrument Serif or system-ui as the
brand face; purple, indigo or violet; gradients, gradient text, glass,
glows and blobs; a card with a soft shadow per item; uniform radius
everywhere; pill badges; emoji or a decorative icon set; a centred hero
stack; teal or emerald; fade-up-on-scroll, springs, hover scale; the
grey-50 page with white cards.

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
- Focus: `2px solid --color-focus`, 2 px offset, on everything. On the
  station row, the ring is drawn inside the row (offset -2 px), so it isn't
  clipped by the list.
- Touch targets: at least 44 × 44 px (`--target-size`), except inline text
  buttons, which are at least 24 px high (WCAG 2.5.8) with space around them.

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
  `[Unleaded 91 ▾] · 2250 · 5 km [Change]`.
  - The fuel is a native `<select>` styled as bold text, named "Fuel", with
    the usual focus ring. Changing it searches again at once, as the form's
    select does.
  - **Change** is a disclosure button ("Change search", `aria-expanded`,
    `aria-controls` the form). Opening keeps focus on it, so the next Tab is
    the form. A successful search closes the form and moves focus to the
    results heading. A failed one ("no such place") keeps it open with focus
    in the place field, and the error announced.
  - The place and distance are text (they are the Change button's
    context).

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

### Station card

Under its row in the list, at every width: brand · address (an
all-capitals address set in title case in the browser; a capitals suburb
in an otherwise careful address given the ABS gazetteer's spelling in the
API), "down 1.0
today" when it moved, a "Price history" link, then Directions (primary
button, opens the phone's maps app), Favourite (toggle, `aria-pressed`),
Close.

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
the accent, the selected one with a heavier edge. The tag is fitted to its
price and takes no part in placement itself, so a price is placed (or
dropped to make way for a dot) exactly as before. Dots stay on top.

The legend, under the map, is the docket's scale bar: three equal bands
(thirds by rank, not by price), the lowest and highest price at its ends,
"Cheapest third / Middle / Dearest third" under them, and the search
centre's ring.

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

## Motion

Only to explain a change of state: the list re-sorting (existing FLIP, 200
ms), a card opening (height and opacity, 180 ms), the map flying to a
station (MapLibre's own). Ease-out, 150–250 ms. All of it is off under
`prefers-reduced-motion`, as `global.css` already enforces.

## Budgets

- Initial CSS: 22 kB raw. Raise it only in a commit that says why, with the
  note in `scripts/check-bundle-budget.js`.
- Fonts (`pnpm bundle:check`): every preloaded font together at most 56 kB,
  all files in `public/fonts/` at most 64 kB, and every preload must point at
  a file that exists.
- CLS 0 in `check:browser`, and PageSpeed held at the round 11 baseline.
