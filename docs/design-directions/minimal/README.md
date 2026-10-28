# Docket, minimal (round 3)

Docket with only what each screen needs. Mockups only, waiting for
approval. `node docs/design-directions/minimal/render.mjs` re-renders
everything in `png/`.

- **Before/after, phone list:** `png/before-after-phone-list.png`. Before is
  production on 28 October, where the first price is below the first
  screen. After: the first price at 243 px, eight full stations and part of a
  ninth on a 390 × 844 screen.
- **Phone, light and dark:** `png/sheet-phone-light.png`, `png/sheet-phone-dark.png`
  (List, a station selected, search reopened, Map, History).
- **Desktop 1280 × 800:** `png/sheet-desktop-light.png`, `png/sheet-desktop-dark.png`
  (results with a station selected, History).
- **What a screen reader gets:** `png/screen-reader.txt`, taken from the
  mockups' accessibility tree.

## Everything removed from view, and where it went

| Removed                                                                  | Where it is now                                                                                                                                                                                    | Steps to reach   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Station row:** address                                                 | The selected-station card (in the list on phones and desktop, under the map in Map view)                                                                                                           | 1: press the row |
| Row: brand                                                               | The card                                                                                                                                                                                           | 1                |
| Row: "↓ 1.0 today"                                                       | The card ("down 1.0 cents a litre today")                                                                                                                                                          | 1                |
| Row: Show on map, Directions, Favourite (3 Tab stops)                    | The row itself is the one button. Directions and Favourite are in the card, and Map shows the station already selected                                                                             | 1                |
| Row: the station name as the price-history link                          | "Price history" link in the card                                                                                                                                                                   | 1                |
| "Cheapest" badge                                                         | A small word in accent colour under the price, and ", cheapest" in the row's accessible name                                                                                                       | 0                |
| **Summary:** cheapest and average lines, the "YOU SAVE" total            | One line: "19 stations · save $3.02 on 50 L". The full sentence is still there for screen readers, unchanged                                                                                       | 0                |
| The scale bar                                                            | The map, as its legend: cheapest, average, dearest on the three bands                                                                                                                              | 1 (Map)          |
| Subtitle "Unleaded 91 · prices as of 6:00 pm"                            | Fuel: the collapsed search line. "As of": one small line after the list ("Unleaded 91 prices as of 6:00 pm, from FuelCheck"). The stale-price warning still appears at the top when prices are old | 0 / scroll       |
| Heading "…within 5 km of postcode 2250"                                  | Still the full `<h2>` for screen readers; visible as "19 stations", with the rest on the collapsed search line                                                                                     | 0                |
| **Search:** "For example Erina, Bondi Beach or 2250"                     | Gone. The label "Suburb or postcode" says it                                                                                                                                                       | n/a              |
| "Only used to find stations near you; never stored."                     | The privacy page (already says it in full), linked from the footer                                                                                                                                 | 1                |
| The form itself, on phones after a search                                | "Unleaded 91 · 2250 · 5 km [Change]"                                                                                                                                                               | 1                |
| Map legend "Cheapest third / Middle / Dearest third"                     | The scale-bar legend on the map, ends labelled "cheapest" and "dearest"                                                                                                                            | 0                |
| **Map card:** List button                                                | The List/Map switch above the map                                                                                                                                                                  | 1                |
| **Favourites bar** with no favourites, and its "No favourites yet…" hint | Hidden. It appears with the first favourite                                                                                                                                                        | n/a              |
| **History:** brand and address                                           | Removed; the station's card has them (Back to results)                                                                                                                                             | 1                |
| "Every fuel here now" table                                              | Disclosure "Every fuel here now"                                                                                                                                                                   | 1                |
| Daily prices table                                                       | Disclosure "Daily prices as a table" (as now)                                                                                                                                                      | 1                |
| Long licence credit                                                      | One small line at the bottom; the full credit stays in the footer                                                                                                                                  | 0                |
| Letter-spaced caps                                                       | Only the wordmark now                                                                                                                                                                              | n/a              |
| Theme select                                                             | Footer (from round 1)                                                                                                                                                                              | scroll           |

## Kept, against the brief's cuts, and why

- **Directions and Favourite on the history view**, as two quiet text
  links under the price. A shared history link (`?history=…`) opens
  straight onto this view with no results under it, so these would
  otherwise take more than one step. Say if you'd rather drop them.
- **"Price history" link in the card.** The row is now a button, so the
  name can't also be the link. This is the one way into history from the
  list.
- **The chart's day readout** ("Fri, 18 Sept · low · high · last"). It's
  the slider's visible value. Without it the chart is unreadable without
  hovering, and keyboard users get nothing.
- **Use my location** in the form. It's a main way in, without its note.

## How the new interactions work (accessibility)

- **Station row:** `<li><h3><button aria-expanded aria-controls>`, the
  WAI-ARIA accordion. One Tab stop. Heading navigation still goes station
  by station. The button's name is the whole row: "Metro Petroleum Gosford
  233.9 cents a litre, cheapest, 3.4 km away, updated 21 hours ago". An
  old price reads "… Old price, 16 days ago". Pressing it opens the card
  right under the row (focus stays on the button; the next Tab is
  "Price history"), selects the station on the map, and closes any other
  open row. Close, Escape inside the card, or pressing the row again
  closes it and returns focus to the row. In Map view, choosing a dot
  opens the same card under the map, as now.
- **Change (phones):** a disclosure button, "Change search",
  `aria-expanded`, controlling the form. Opening it keeps focus on Change,
  and the next Tab is Fuel. Submitting closes the form and moves focus to
  the results heading, as a search does now. If the search fails ("no such
  place"), the form stays open with focus in the place field and the
  error announced, so a typo can be fixed in place. Landing on a URL with
  no search shows the form open, with no Change button. From 60rem the
  form is a single row and never collapses.
- **Labels stay visible:** Fuel, Within, Suburb or postcode, Sort (an
  `aria-label` on the select, plus the selected value "Cheapest first" is
  visible, as now).
- **Decorative characters** (leaders, `·` between distance and age, `↗`,
  `☆`/`★`, `↓`, `←`) are `aria-hidden`, with the words in visually-hidden
  text where they carry meaning.

## Risks, and the test for each

- **Changing fuel now takes two presses on a phone** (Change, then the
  select). It's the most common second action after a search. If it
  feels slow in use, the fuel select could stay visible on the collapsed
  line. Test: the browser check changes fuel on a phone after a search.
- **A row is one big button.** Selecting text in it (copying a station
  name) is harder. The name is selectable in the card.
- **Long station names wrap to two lines** ("Ampol Foodary Gosford West
  (East Bound)"); the leader then sits on the last line. A test at 320 px
  with 200% text: no row clips its price.
- **A screen reader user hearing a long button name per row.** It's the
  same information as now, in one stop instead of a heading, a paragraph and
  three buttons. VoiceOver and NVDA read the whole name. I'll check on
  iOS VoiceOver that the visually-hidden commas give natural pauses rather
  than fragments (round 8 found fragmenting in the summary).
- **Desktop has one card location:** inline in the list, not under the
  map. The map stays clear, and there's one component instead of two
  placements on wide screens.
