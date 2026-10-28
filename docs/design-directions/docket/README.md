# Docket, round 2: your notes applied, desktop and history

Mockups only, waiting for approval before any `src/` change.
`node docs/design-directions/docket/render.mjs` re-renders them.

- Phone, light and dark: `png/sheet-phone-light.png`, `png/sheet-phone-dark.png` (List, Map, History)
- Desktop 1280 × 800, light and dark: `png/sheet-desktop-light.png`, `png/sheet-desktop-dark.png` (results with the map, History)

## Your notes

| Note                                                          | What changed                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No asterisks on "Cheapest"                                    | An inverted strip: "CHEAPEST" in paper-on-carbon-blue under the price, like a highlighted docket line. The same treatment is used for the cheapest map tag. Screen readers get ", cheapest" after "cents a litre"; the visible strip is `aria-hidden`.                                      |
| Caps mono only for short labels                               | Caps mono is kept for one- or two-word labels (FUEL, WITHIN, FAVOURITES, CHEAPEST, AVERAGE, YOU SAVE, LIST/MAP, PRICE HISTORY). Sentences are set in Atkinson Next, sentence case: "Unleaded 91 · prices as of 6:00 pm", "filling 50 litres at the cheapest", the legend, the readout hint. |
| Halftone water                                                | Dropped. Water is a flat pale blue-grey (dark: deep slate blue) with a thin shore line and an italic name. It now reads as water at a glance. The bands still pass 3:1 on it (`palettes.mjs`: 3.47 is the lowest, the grey band on light water).                                            |
| Quieter row actions                                           | Muted colour, one size down, a hairline underline in the rule colour. The three Tab stops are unchanged. Name and price now carry the row.                                                                                                                                                  |
| Keep leaders, YOU SAVE, map tags, stripped roads, mono prices | Kept.                                                                                                                                                                                                                                                                                       |
| B's scale bar                                                 | Under the docket total: the spread from cheapest to dearest in the map's three bands, with the average marked. It's `aria-hidden`, because the sentence already says it, and it stands in for the map legend on the List screen.                                                            |

## Where I'd draw the line on decoration

**Keep (each one carries meaning or structure):**

- **The torn top edge**, once, where the docket strip starts. It marks
  "this is the answer to your search" and is the identity's one flourish.
- **Dotted leaders** between label and figure. That's their job on a real
  docket: they tie a name to its price across the gap.
- **Dashed rules between line items, and the double rule over the
  total.** They're dividers, doing the job card borders do today.
- **Boxed map tags, inverted for the cheapest.**

**Leave out:**

- A torn _bottom_ edge, perforations, or a docket shadow. One tear is enough.
- Fake receipt furniture: docket numbers, "TAX INVOICE", ABN, barcodes,
  "THANK YOU, DRIVE SAFELY". Cute once, noise every visit, and dishonest
  copy.
- The masthead leader from round 1, which led to nothing.
- Halftone or any other texture, including paper grain.
- Monospace for body text or station names.
- Motion beyond what the brief allows. In particular no "printing"
  animation of the list.

## Desktop (1280 px)

- **Search becomes one horizontal bar** under the masthead: Fuel, Within,
  Suburb or postcode, Search, then Use my location with its note. Below it,
  the docket (480 px) and the map (the rest, sticky) sit side by side. The
  first price is at about 520 px on a 1280 × 800 screen, with the summary
  and scale bar above it.
- **A change to round 10's decision:** from 1440 px the form currently sits in a
  column of its own and stays in view. I propose the bar at every wide
  width instead, made sticky from 1440 px so it still stays in view. That
  gives the map the full width. If you'd rather keep the column at 1440 px,
  it's a small CSS change, not a redesign.
- The List/Map switch isn't shown on wide screens, as now.
- The station shown on the map gets a 3 px ink rule down its left in the
  list. The selected strip under the map repeats it, with Directions,
  Favourite and Close. Today's "Shown on map" words stay too (not in the
  mockup).

## History

Order (phone and desktop): Back to results → "PRICE HISTORY · UNLEADED 91"
→ station name (the `<h2>`, still "Price history: …" to screen readers) →
brand and full address → **today's price at the largest size in the app** →
Directions, Favourite → the lowest/highest sentence → **the chart** → day
readout and slider hint → every fuel here now (a docket of leaders) → "Daily
prices as a table" → credit. On desktop, every-fuel and the table move to a
right-hand column, beside the chart.

The chart is a thermal print: an ink trace of the last price, the low–high
range as a pale band, dotted quiet gridlines, mono axis labels, and the
slider's day as a dotted carbon-blue cursor. The "No data" gap shading stays.
The fixtures end on 30 September, so the gap doesn't appear here.

## Screen readers: decorative characters, for part 2

All `aria-hidden`, with words where needed: the leaders (empty spans),
`↗` after Directions, `☆` before Favourite, `↓`/`↑` in "today" (with the
words "down 1.0 cents a litre since yesterday", as now), `←` in Back to
results, the CHEAPEST strip (words carried in the price's accessible text),
the docket total (already a visually-hidden sentence), and the scale bar.
The `·` separators in meta lines are left as they are: NVDA and VoiceOver
skip them at default punctuation, and they're in today's app.

## Fonts budget, for part 2

`bundle:check` gains a fonts budget for the files in `public/fonts/`: the
preloaded first-paint face (Atkinson Next, 34 kB) at most 40 kB, and all
fonts together at most 60 kB (now 52 kB). It fails if a font is preloaded
that isn't the first-paint face.

## Noticed in the mockups

- **Atkinson draws a slashed zero by default**, in Next as well as Mono
  ("2250", "6:00", "150.9"). That's part of its low-vision design, and
  neither font has a `zero` feature to switch it off. In mono figures it
  looks right. In sentences it's slightly unusual. I'd keep it; the
  alternative would be a different text face, which loses the one-family
  benefit.
