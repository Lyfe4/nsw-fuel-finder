# Fuel Finder — Redesign Brief

Drop this file in the repo at `docs/design-brief.md`. Part 1 and 2 are for you (study them before the session). Part 3 is the prompt to paste into Claude Code.

---

## Part 1 — Real products worth studying (and what to steal from each)

Don't copy any one of these. Each is here for a specific lesson that applies to a live-price, map + list app.

### Live data, numbers as the hero

| Site                            | Steal this                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Flighty** — flighty.com       | Data-dense status UI that still feels premium. Big tabular numbers, tiny precise labels, colour used only for state changes. The closest analogue to "is this price good right now?" |
| **Mercury** — mercury.com       | How a finance product makes figures feel expensive: restrained palette, serious typography, generous negative space around numbers.                                                  |
| **Windy** — windy.com           | Map-first live data with an overlay legend that stays out of the way.                                                                                                                |
| **Citymapper** — citymapper.com | Confident colour, personality in copy, map + list working as one tool.                                                                                                               |
| **Transit** — transitapp.com    | Big bold departure numbers readable at a glance on a phone — same job as a petrol price.                                                                                             |

### Craft, restraint, density

| Site                                 | Steal this                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Linear** — linear.app              | Density without clutter; hairline borders and type weight doing the work instead of cards and shadows. |
| **Things** — culturedcode.com/things | Micro-interaction polish; every state transition considered.                                           |
| **Rauno Freiberg** — rauno.me        | Interaction details: hover/press states, motion timing, focus rings that look designed.                |
| **Emil Kowalski** — emilkowal.ski    | Motion that feels physical, never decorative.                                                          |

### Character — the anti-generic references

| Site                                          | Steal this                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Teenage Engineering** — teenage.engineering | Industrial labelling, monospaced spec-sheet typography, a hardware feel. Very fitting for automotive/fuel. |
| **Nothing** — nothing.tech                    | Dot-matrix display aesthetic used with discipline — think of the roadside price sign.                      |
| **Up Bank** — up.com.au                       | Australian, playful but premium; proves a utility can have a voice.                                        |
| **Stripe Press** — press.stripe.com           | Typography with real richness; editorial confidence.                                                       |
| **The Pudding** — pudding.cool                | Data storytelling — useful for the price-history view.                                                     |

### Maps done beautifully

| Site                    | Steal this                                                                  |
| ----------------------- | --------------------------------------------------------------------------- |
| **Felt** — felt.com     | Modern custom basemaps; map chrome that feels designed rather than default. |
| **Stamen** — stamen.com | Cartography as a craft; custom map styles with a point of view.             |

Your current map is OpenFreeMap Positron/Dark — a custom MapLibre style (muted land, roads tinted to match your palette, labels in your typeface) is one of the biggest single upgrades available.

---

## Part 2 — Resources

### Inspiration galleries (curated, not Dribbble)

- **Godly** — godly.website — high-end, motion-heavy web.
- **Siteinspire** — siteinspire.com — quieter, typographic, filterable by style.
- **Minimal Gallery** — minimal.gallery
- **Httpster** — httpster.net
- **Land-book** — land-book.com
- **Awwwards** — awwwards.com (filter by "Sites of the Day", ignore the gimmicky ones)
- **Refero** — refero.design — real product screens by flow/pattern. It also has an **MCP server** you can connect to Claude Code so it can pull real UI references itself instead of falling back on its defaults. Worth setting up for this.
- **Mobbin** — mobbin.com — mobile app patterns (search/filters/maps).
- **Screensdesign** — screensdesign.com (includes Flighty's screens).

### Typography

- **Fonts In Use** — fontsinuse.com — see typefaces in real contexts (search "road signage", "petrol").
- **Typewolf** — typewolf.com — pairings and "what font is that site using".
- **Practical Typography** — practicaltypography.com — Butterick's rules, short and essential.
- **Free distinctive foundries (OFL, self-hostable):** Velvetyne (velvetyne.fr), Collletttivo (collletttivo.it), Uncut (uncut.wtf), Fontshare (fontshare.com — but avoid Satoshi/General Sans, now AI-default).
- **Paid, if you want truly premium:** Klim, Grilli Type, Commercial Type, Pangram Pangram.

### Principles and craft

- **Refactoring UI** — refactoringui.com — the most practical book on making UI look designed.
- **Vercel Web Interface Guidelines** — vercel.com/design/guidelines — a concrete checklist of interaction details.
- **"Invisible Details of Interaction Design"** — Rauno Freiberg (rauno.me)
- **animations.dev** — Emil Kowalski's motion course.
- **Laws of UX** — lawsofux.com
- **Every Layout** — every-layout.dev — intrinsic CSS layout.
- **Utopia** — utopia.fyi — fluid type and space scales.
- **Josh W. Comeau** — joshwcomeau.com — CSS depth (shadows, gradients done well).
- **Datawrapper blog** — datawrapper.de/blog — colour in data viz, for your price bands and history chart.

---

## Part 3 — Prompt for Claude Code

Copy everything inside the block below.

```text
We're redesigning the visual layer of this app (NSW Fuel Finder: live fuel prices, cheapest first, list + MapLibre map + per-station price history). The design brief with references is at docs/design-brief.md — read it first.

GOAL
A high-end, distinctive interface with a clear point of view. It must not look AI-generated or templated. Someone should be able to recognise it from a cropped screenshot.

DO NOT use the frontend-design skill or any default "modern SaaS" aesthetic. Follow this brief instead.

THE CONCEPT
Fuel prices already have a visual culture in Australia: the roadside pylon price board, highway signage, the servo docket, the street-directory map. Build the identity from that world, not from web-app conventions. The price number is the hero of every screen.

Before writing any code, propose THREE distinct directions, each as: a name, a one-paragraph rationale, typefaces (with licences), a palette (light + dark), how the price number is rendered, how a station row looks, and what the map style becomes. Starting points (develop or replace them):
  A. "Price Board" — the price as a display-face numeral like a pylon sign (consider a segment or dot-matrix face, e.g. DSEG, used only for the price), dark sign-panel surfaces, everything else quiet.
  B. "Road Atlas" — cartographic: paper tones, hairline rules, a typeface descended from highway signage (e.g. Overpass, which derives from Highway Gothic, or Barlow, from Californian road signs), the map leads and the list reads like an atlas index.
  C. "Docket" — receipt/ledger: monospaced figures, dotted leaders between station and price, the savings sentence presented like a docket total.
Wait for me to pick one before building.

BANNED (these read as "AI made this")
- Fonts: Inter, Geist, Space Grotesk, DM Sans, Poppins, Plus Jakarta Sans, Satoshi, Instrument Serif, system-ui as the brand face.
- Purple/indigo/violet accents, blue-to-purple gradients, gradient text, glassmorphism, blurred blobs, glow effects.
- Every item in a rounded card with a soft drop shadow. Uniform border-radius everywhere. Pill badges on everything.
- Emoji as icons; a generic icon set sprinkled for decoration.
- Centred hero with a headline + subhead + button stack.
- Default teal/emerald "success" accent (the current teal included).
- Fade-up-on-scroll animations, bouncy springs, hover scale on cards.
- shadcn/Tailwind-default look, grey-50 backgrounds with white cards (the current layout).

PRINCIPLES
- Hierarchy through type size, weight and spacing first; colour and containers last. Prefer rules/dividers and alignment over boxes.
- Tabular, lining figures for every number (font-variant-numeric: tabular-nums). Prices align on the decimal.
- One accent colour, used only for meaning (cheapest / price moved). Everything else neutral, but tinted neutrals, not pure grey.
- A real type scale (use Utopia-style fluid clamp() steps) and a 4px-based spacing scale. Max 2 typefaces + optionally one display face only for prices.
- Copy is part of the design: keep the plain-English, direct voice already in the app.
- Motion only to explain state change (list re-sorting, a price ticking down, panel opening), 150–250ms, ease-out, and fully disabled under prefers-reduced-motion.
- Design phone first; the phone list view is the most-used screen.
- Make the map match: write a custom MapLibre style (adapt OpenFreeMap's) so land, water, roads and labels use our palette and typeface in both themes.
- Plan for more states later: nothing in the identity should say "NSW" structurally.

NON-NEGOTIABLE CONSTRAINTS (from this repo — read docs/decisions.md)
- Keep the token architecture in src/styles/tokens.css (primitives → semantic tokens). Components never write raw colours; src/styles/tokens.test.ts must still pass, including WCAG AA contrast in both themes and the colour-blind ΔE check on the price bands. Don't weaken the tests to make a design pass.
- Colour is never the only signal; "Cheapest" and stale prices stay in words.
- Keep native <select>s and the Downshift combobox; restyle them, don't replace them. Visible, designed focus states.
- CSP allows styles and fonts only from our own origin: self-host fonts as subsetted woff2 in /public, no Google Fonts links. Respect the bundle budgets (pnpm bundle:check); preload only the one font the first paint needs.
- No new UI libraries, no Tailwind, no router/state library. CSS Modules as now.
- Keep all URL state behaviour and accessibility tests (pnpm test, pnpm check:a11y).

PROCESS
1. Read docs/design-brief.md, docs/decisions.md, src/styles/tokens.css and the screenshots in docs/screenshots/.
2. Write the three directions (above). Wait for my choice.
3. Write docs/design-system.md for the chosen direction: type scale, spacing, palette primitives with contrast ratios, the price numeral spec, row anatomy, map style notes, motion rules. This is the source of truth.
4. Implement tokens and fonts first, then the station row/price, then the search form, summary sentence, filters, map style, history chart, favourites.
5. After each step run pnpm screenshots (and pnpm test) and LOOK at the phone and desktop shots in both themes. Critique them against the brief and the BANNED list in writing, honestly, then fix before moving on. Ask: "Could this screenshot be any other AI-built app?" If yes, push further.
6. Finish with pnpm typecheck, lint, test, build, bundle:check all passing, and updated screenshots.
```

---

### Tips for the session

- Connecting the **Refero MCP** to Claude Code lets it look up real-world UI for a pattern ("price list rows", "map filters") rather than inventing from its defaults.
- Give it 2–3 screenshots of references you personally love (e.g. a Flighty screen, a Teenage Engineering product page) — images steer it more than adjectives.
- Be ruthless in step 2: if none of the three directions excites you, ask for three more.
