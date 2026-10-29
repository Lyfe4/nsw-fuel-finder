/**
 * Fails the build when a payload grows past its budget. Adapted from
 * Patchbay's scripts/check-bundle-budget.js, with the budgets this app needs:
 *
 * - INITIAL JS and CSS: what the browser must download before it can show
 *   the search screen. The entry module plus every chunk index.html
 *   preloads, and the stylesheets it links. This is the budget that matters
 *   to every visitor, so it is held close to where it is.
 * - THE HISTORY VIEW's chunk: the price chart, lazy like the map.
 * - THE FONTS: every font index.html preloads (the first paint waits on
 *   them), and every font in public/fonts. A preload must name a file that
 *   exists: a typo would cost a wasted request and the fallback face.
 * - THE LARGEST LAZY CHUNK, and MapLibre's WORKER: the map. Off the critical
 *   path (src/features/map/LazyStationMap.tsx), but a phone opening the map
 *   on a slow connection pays for them, so they have ceilings too. A lazy
 *   chunk is "not on the first load", which is not the same as free.
 *
 * Budgets are raw (uncompressed) bytes, as in Patchbay: gzip sizes move with
 * the compressor, raw sizes only with the code. Raise one deliberately, in a
 * commit that says why. Run with `pnpm bundle:check` after a build; CI runs it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Sizes here are kB of 1,024 bytes; Vite's build output counts 1,000, so it
// prints larger numbers for the same files.
//
// Measured at 316.7 kB raw / 97.5 kB gzipped in round 5, up from 311.2 kB in
// round 4 (dark mode, list batches). 332 kB was 5% headroom.
// RAISED IN ROUND 8, on purpose: 333.9 kB raw / 102.9 kB gzipped, +9.7 kB
// (+3.0 kB gzipped) for sort, filters, the price summary, today's change,
// directions and the clear button. All of it is on screen with the first
// results, so lazy-loading it would only delay it. 350 kB is 5% headroom
// again: room for a small feature, not for a library in the entry chunk.
const INITIAL_JS_BUDGET = 350 * 1024;
// Measured at 15.6 kB raw / 3.6 kB gzipped in round 5. Raised in round 8 for
// the same features: 20.6 kB raw / 4.5 kB gzipped.
// RAISED FOR THE REDESIGN, on purpose: 22.3 kB raw at its first step. The
// four @font-face rules (two faces and their metric-matched fallbacks, which
// keep the font swap from moving anything), the folded search line and the
// docket's torn edge are new; the card styles they replace mostly went, but
// not all of the old components are restyled yet.
// MEASURED AGAIN at milestone 2 (one-row toolbar, favourites, map legend,
// old card rules and unused tokens gone): 23.1 kB raw / 5.3 kB gzipped. Less
// left to remove than hoped: the old rules were mostly replaced, not added
// to, and the new parts (fonts, folded search, card, scale bar) are real.
// 24 kB is about 4% headroom, as the other budgets have. The history view's
// styles are in its own lazy chunk, so its redesign does not touch this.
// RAISED IN ROUND 14, on purpose: 24.1 kB raw / 5.5 kB gzipped, +0.8 kB
// from 23.3 for the icon set (icon sizing, icon-only buttons, the
// disclosure chevron in place of the browser's marker), the one-line
// search with its ellipsis and search toggle, the card's one action row
// and the zoom buttons. All of it is on the first screen. 25 kB is about
// 4% headroom again. The icons' JavaScript (12 Tabler icons, about 2 kB)
// is inside the unchanged initial JS budget, which would also catch the
// set's whole index slipping in (eslint.config.js forbids importing it).
const INITIAL_CSS_BUDGET = 25 * 1024;
// The map chunk: MapLibre itself, measured at 1,016.0 kB raw / 273.1 kB
// gzipped (MapLibre 6.14). It cannot be split further.
const LAZY_CHUNK_BUDGET = 1100 * 1024;
// MapLibre's self-contained worker, measured at 496.4 kB raw / 141.4 kB gzipped.
const WORKER_BUDGET = 540 * 1024;
// The price history view (chart, table, summary): its own chunk, fetched when
// a station's history is first opened. Measured at 8.4 kB raw / 3.3 kB
// gzipped in round 6. Hand-drawn SVG, no chart library; 16 kB leaves room to
// grow, not room for a library to slip in.
const HISTORY_CHUNK_BUDGET = 16 * 1024;
// The fonts (redesign, docs/design-system.md): Atkinson Hyperlegible Next
// (33.2 kB) and Mono (17.3 kB), both preloaded because the first paint has
// both (the wordmark is in the mono). Already compressed (woff2), so raw is
// what crosses the network. 56 kB preloaded and 64 kB in all leave room for
// a re-subset, not for a third face.
const PRELOADED_FONTS_BUDGET = 56 * 1024;
const ALL_FONTS_BUDGET = 64 * 1024;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');
const assetsDir = join(distDir, 'assets');

/** Every URL in index.html of a given kind: entry scripts, module preloads, stylesheets. */
function linkedUrls(html) {
  const urls = { js: new Set(), css: new Set() };
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (!url?.startsWith('/assets/')) continue;
    const isEntry = tag.startsWith('<script') && tag.includes('type="module"');
    const isPreload = tag.includes('rel="modulepreload"');
    const isStylesheet = tag.includes('rel="stylesheet"');
    if ((isEntry || isPreload) && url.endsWith('.js')) urls.js.add(url);
    if (isStylesheet && url.endsWith('.css')) urls.css.add(url);
  }
  return { js: [...urls.js], css: [...urls.css] };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const failures = [];

function measure(title, files, budget) {
  let raw = 0;
  let gzip = 0;
  console.warn(`${title}:`);
  for (const file of files) {
    const path = join(distDir, file.replace(/^\//, ''));
    const size = statSync(path).size;
    const zipped = gzipSync(readFileSync(path)).length;
    raw += size;
    gzip += zipped;
    console.warn(`  ${file.padEnd(48)} ${kb(size).padStart(10)}  ${kb(zipped).padStart(9)} gz`);
  }
  if (files.length > 1) {
    console.warn(`  ${'TOTAL'.padEnd(48)} ${kb(raw).padStart(10)}  ${kb(gzip).padStart(9)} gz`);
  }
  console.warn(`  ${'BUDGET'.padEnd(48)} ${kb(budget).padStart(10)}\n`);
  if (raw > budget) {
    failures.push(`${title} is ${kb(raw)}, over its ${kb(budget)} budget by ${kb(raw - budget)}.`);
  }
  return raw;
}

const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const initial = linkedUrls(html);
const assets = readdirSync(assetsDir);

// A check that finds nothing to measure has quietly stopped measuring: fail.
if (initial.js.length === 0 || initial.css.length === 0) {
  console.error('bundle-budget: FAIL - found no initial script or stylesheet in dist/index.html');
  process.exit(1);
}
const lazyChunks = assets
  .filter((name) => name.endsWith('.js') && !initial.js.includes(`/assets/${name}`))
  .map((name) => ({ url: `/assets/${name}`, raw: statSync(join(assetsDir, name)).size }))
  .toSorted((a, b) => b.raw - a.raw);
const workers = assets.filter((name) => name.startsWith('maplibre-gl-worker-'));
const history = assets.filter((name) => name.startsWith('HistoryView-') && name.endsWith('.js'));
if (lazyChunks.length === 0 || workers.length === 0 || history.length === 0) {
  console.error('bundle-budget: FAIL - no lazy map chunk, MapLibre worker or history chunk.');
  console.error('The map and the history view are meant to be lazy. Has code splitting broken?');
  process.exit(1);
}

const js = measure('Initial JavaScript', initial.js, INITIAL_JS_BUDGET);
const css = measure('Initial CSS', initial.css, INITIAL_CSS_BUDGET);
const [largest] = lazyChunks;
const lazy = measure('Largest lazy chunk', [largest.url], LAZY_CHUNK_BUDGET);
const historyView = measure(
  'History view chunk',
  history.map((name) => `/assets/${name}`),
  HISTORY_CHUNK_BUDGET,
);
const worker = measure(
  'MapLibre worker',
  workers.map((name) => `/assets/${name}`),
  WORKER_BUDGET,
);

/* Fonts: what index.html preloads, and everything in dist/fonts. */
const fontsDir = join(distDir, 'fonts');
const fontFiles = readdirSync(fontsDir).filter((name) => name.endsWith('.woff2'));
const preloadedFonts = [...html.matchAll(/<link\b[^>]*>/g)]
  .map(([tag]) => tag)
  .filter((tag) => tag.includes('rel="preload"') && tag.includes('as="font"'))
  .map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1] ?? '');
if (fontFiles.length === 0 || preloadedFonts.length === 0) {
  console.error('bundle-budget: FAIL - no fonts in dist/fonts, or none preloaded in index.html.');
  process.exit(1);
}
for (const url of preloadedFonts) {
  if (!url.startsWith('/fonts/') || !fontFiles.includes(url.slice('/fonts/'.length))) {
    failures.push(`index.html preloads ${url}, which is not a font in public/fonts.`);
  }
}
const preloaded = measure(
  'Preloaded fonts',
  preloadedFonts.filter((url) => fontFiles.includes(url.slice('/fonts/'.length))),
  PRELOADED_FONTS_BUDGET,
);
const fonts = measure(
  'All fonts',
  fontFiles.map((name) => `/fonts/${name}`),
  ALL_FONTS_BUDGET,
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`bundle-budget: FAIL - ${failure}`);
  console.error('Move the new code behind a dynamic import, or raise the budget on purpose.');
  process.exit(1);
}

console.warn(
  `bundle-budget: OK - headroom ${kb(INITIAL_JS_BUDGET - js)} initial JS, ${kb(
    INITIAL_CSS_BUDGET - css,
  )} initial CSS, ${kb(LAZY_CHUNK_BUDGET - lazy)} map chunk, ${kb(WORKER_BUDGET - worker)} worker, ${kb(
    HISTORY_CHUNK_BUDGET - historyView,
  )} history, ${kb(PRELOADED_FONTS_BUDGET - preloaded)} preloaded fonts, ${kb(
    ALL_FONTS_BUDGET - fonts,
  )} all fonts.`,
);
