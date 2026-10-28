/**
 * The README's screenshots, the Open Graph card and a hero image, made the
 * same way every time:
 *
 *   pnpm build && pnpm screenshots            # from the committed fixtures
 *   pnpm screenshots --record                 # re-record them from production first
 *   pnpm screenshots --record --from http://localhost:4175
 *                                             # ...or from a local API (an API change
 *                                             # not yet deployed, on production's data)
 *
 * FIXED DATA. /api/* is answered from scripts/screenshots/fixtures/, recorded
 * from production by --record (reads only: no API.NSW call, no Blobs write),
 * and the clock is fixed a few minutes after the recorded snapshot, so
 * "updated 2 hours ago" never drifts. The page itself is the real build,
 * served locally by `vite preview`; only the map's tiles come live from
 * OpenFreeMap. Every map capture waits for MapLibre's first complete render.
 *
 * Netlify's badge is only on the live site; with --base pointed there it is
 * hidden for the captures, and only for them.
 *
 * Output: docs/screenshots/*.png (README), public/og-image.png (1200x630,
 * linked from index.html), docs/screenshots/hero.png (for a portfolio page).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';
import { preview } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'scripts/screenshots/fixtures');
const OUT = join(ROOT, 'docs/screenshots');
const PRODUCTION = 'https://nsw-fuel-finder.netlify.app';

/** The scene: a Central Coast search, its cheapest station, three favourites. */
const SEARCH = { fuel: 'U91', query: '2250' };

const { values } = parseArgs({
  options: {
    record: { type: 'boolean', default: false },
    from: { type: 'string', default: PRODUCTION },
    base: { type: 'string' },
  },
});
mkdirSync(FIXTURES, { recursive: true });
mkdirSync(OUT, { recursive: true });

const fixturePath = (name) => join(FIXTURES, `${name}.json`);
const readFixture = (name) => JSON.parse(readFileSync(fixturePath(name), 'utf8'));

async function record() {
  const get = async (path) => {
    const response = await fetch(`${values.from}${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${String(response.status)}`);
    return response.json();
  };
  const prices = await get(`/api/location?fuel=${SEARCH.fuel}&query=${SEARCH.query}`);
  const [cheapest, second, third] = prices.stations;
  const codes = [cheapest, second, third].map((s) => s.stationCode);
  const stations = await get(`/api/stations?codes=${[...codes].sort().join(',')}`);
  const history = await get(`/api/history?station=${cheapest.stationCode}&fuel=${SEARCH.fuel}`);
  writeFileSync(fixturePath('location'), `${JSON.stringify(prices, null, 2)}\n`);
  writeFileSync(fixturePath('stations'), `${JSON.stringify(stations, null, 2)}\n`);
  writeFileSync(fixturePath('history'), `${JSON.stringify(history, null, 2)}\n`);
  console.warn(`Recorded fixtures from ${values.from} (snapshot ${prices.fetchedAt}).`);
}

if (values.record) await record();

const prices = readFixture('location');
const stations = readFixture('stations');
const history = readFixture('history');
const [cheapest] = prices.stations;
const favourites = stations.stations.map((s) => ({ code: s.stationCode, name: s.name }));
/** The brand with most stations in the scene, for the filters capture. */
const [topBrand] = Object.entries(Object.groupBy(prices.stations, (station) => station.brand)).sort(
  (a, b) => b[1].length - a[1].length,
)[0];
const now = new Date(Date.parse(prices.fetchedAt) + 7 * 60_000);

const server = values.base ? null : await preview({ preview: { port: 4180, strictPort: true } });
const BASE = values.base?.replace(/\/$/, '') ?? 'http://localhost:4180';

const browser = await chromium.launch();

/** A page in one theme and size, answering /api/* from the fixtures. */
async function open({ theme, width, height, scale, withFavourites = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: theme,
    reducedMotion: 'reduce',
    ...(width < 600 ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.addInitScript(
    ([theme, favourites]) => {
      window.localStorage.setItem('fuel-finder:theme:v1', theme);
      window.localStorage.setItem('fuel-finder:favourites:v1', JSON.stringify(favourites));
    },
    [theme, withFavourites ? favourites : []],
  );
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/history')
      ? history
      : path.endsWith('/stations')
        ? stations
        : prices;
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(now);
  return { context, page };
}

async function settle(page, { map = false } = {}) {
  if (map) {
    // Headless Chromium draws WebGL in software, where the wide map waits to
    // be asked (src/features/map/mapStart.ts). Ask, then put focus back, so
    // no focus ring shows.
    const canvas = page.locator('canvas.maplibregl-canvas');
    const showMap = page.getByRole('button', { name: 'Show the map' });
    await canvas.or(showMap).first().waitFor();
    if (await showMap.isVisible()) {
      await showMap.click();
      await canvas.waitFor();
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
    }
    await canvas.waitFor();
    await page.getByText('Loading map…').waitFor({ state: 'detached', timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    // Labels fade in after the tiles; give them their moment.
    await page.waitForTimeout(800);
  }
  await page.addStyleTag({ content: '#nl-badge-frame { display: none !important; }' });
}

const url = (extra = '') => `${BASE}/?fuel=${SEARCH.fuel}&query=${SEARCH.query}${extra}`;
const shots = [];
async function shoot(page, name, options = {}) {
  const path = join(OUT, `${name}.png`);
  // Chromium now and then refuses a capture ("Unable to capture screenshot")
  // on a page that captures fine a moment later: try a few times.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.screenshot({ path, ...options });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(1000);
    }
  }
  shots.push(path);
  console.warn(`  docs/screenshots/${name}.png`);
}

try {
  for (const theme of ['light', 'dark']) {
    // Desktop: the list beside the map, fitted to every station.
    {
      const { context, page } = await open({ theme, width: 1280, height: 800, scale: 1 });
      // The cheapest station's row open: its card in the list, its dot on the map.
      await page.goto(url(`&station=${cheapest.stationCode}`));
      await settle(page, { map: true });
      await page.waitForTimeout(500);
      await shoot(page, `desktop-${theme}-results`);
      await page.goto(url(`&history=${cheapest.stationCode}`));
      await page.getByRole('slider').waitFor();
      await settle(page);
      await shoot(page, `desktop-${theme}-history`);
      await context.close();
    }
    {
      const { context, page } = await open({
        theme,
        width: 1280,
        height: 800,
        scale: 1,
        withFavourites: true,
      });
      await page.goto(`${BASE}/`);
      await page.getByRole('list', { name: /^Favourites/ }).waitFor();
      await settle(page);
      await shoot(page, `desktop-${theme}-favourites`);
      await context.close();
    }
    // Phone: list, map, history.
    {
      const { context, page } = await open({ theme, width: 390, height: 844, scale: 2 });
      await page.goto(url());
      await page.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
      await settle(page);
      // From the top: the masthead, the folded search line, then the docket.
      await shoot(page, `phone-${theme}-results`);
      // A station's row open, its card under it.
      await page.goto(url(`&station=${cheapest.stationCode}`));
      await page.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
      await settle(page);
      await shoot(page, `phone-${theme}-selected`);
      await page.goto(url(`&view=map`));
      await settle(page, { map: true });
      // From the List/Map switch down: the switch, the map, its key and the card.
      await page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="Show results as"]');
        if (group) window.scrollTo(0, group.getBoundingClientRect().top + window.scrollY - 12);
      });
      await shoot(page, `phone-${theme}-map`);
      await page.goto(url(`&history=${cheapest.stationCode}`));
      await page.getByRole('slider').waitFor();
      await settle(page);
      await page.evaluate(() => {
        document.getElementById('history-heading')?.scrollIntoView();
      });
      await shoot(page, `phone-${theme}-history`);
      // Sort and filters: the panel open, one brand ticked.
      await page.goto(url(`&brand=${encodeURIComponent(topBrand)}`));
      await page.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
      await page.getByText('Filters:').click();
      await settle(page);
      await page.evaluate(() => {
        document.getElementById('results-heading')?.scrollIntoView();
      });
      await shoot(page, `phone-${theme}-filters`);
      await context.close();
    }
  }

  // Very wide (1600 px): the search form one row across the top.
  {
    const { context, page } = await open({ theme: 'light', width: 1600, height: 900, scale: 1 });
    await page.goto(url());
    await settle(page, { map: true });
    await shoot(page, 'wide-light-results');
    await context.close();
  }

  // --- Composed images: the Open Graph card and a hero ----------------------
  const image = (name) =>
    `data:image/png;base64,${readFileSync(join(OUT, `${name}.png`)).toString('base64')}`;
  const tokens = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');
  const colour = (name) => new RegExp(`--palette-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)[1];
  const css = `
    * { box-sizing: border-box; margin: 0; }
    body { width: var(--w); height: var(--h); overflow: hidden;
      font-family: system-ui, 'Segoe UI', Roboto, Arial, sans-serif; color: ${colour('thermal')};
      background: radial-gradient(circle at 20% 10%, ${colour('carbon-700')}, ${colour('night-950')} 70%); }
    .desktop { position: absolute; border-radius: 14px; overflow: hidden;
      box-shadow: 0 30px 80px rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.15); }
    .desktop .bar { height: 30px; background: ${colour('night-800')}; display: flex; gap: 8px; align-items: center; padding: 0 14px; }
    .desktop .bar i { width: 11px; height: 11px; border-radius: 50%; background: ${colour('night-600')}; }
    .desktop img, .phone img { display: block; width: 100%; }
    .phone { position: absolute; border-radius: 38px; overflow: hidden; border: 10px solid ${colour('ink')};
      box-shadow: 0 30px 70px rgba(0,0,0,.6); background: ${colour('ink')}; }
    h1 { font-size: var(--title); line-height: 1.05; font-weight: 750; letter-spacing: -0.02em; }
    p { font-size: var(--sub); line-height: 1.35; opacity: .9; margin-top: 18px; }
    .mark { width: 64px; height: 64px; margin-bottom: 26px; }
  `;
  const mark = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8').replace(
    '<svg ',
    '<svg class="mark" ',
  );
  const compose = async (name, width, height, scale, body) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(
      `<html><head><style>:root{--w:${width}px;--h:${height}px;--title:${width > 1300 ? 76 : 62}px;--sub:${width > 1300 ? 30 : 26}px}${css}</style></head><body>${body}</body></html>`,
    );
    await page.screenshot({ path: name });
    await page.close();
    shots.push(name);
    console.warn(`  ${name.replace(ROOT, '').replace(/\\/g, '/')}`);
  };

  await compose(
    join(ROOT, 'public/og-image.png'),
    1200,
    630,
    1,
    `<div style="position:absolute;left:70px;top:150px;width:560px">
       ${mark}<h1>Fuel Finder</h1>
       <p>Live fuel prices near you, cheapest first, on a list and a map, with four months of price history.</p>
     </div>
     <div class="phone" style="left:700px;top:60px;width:300px;transform:rotate(-4deg)"><img src="${image('phone-light-map')}"></div>
     <div class="phone" style="left:900px;top:110px;width:270px;transform:rotate(5deg)"><img src="${image('phone-dark-results')}"></div>`,
  );

  await compose(
    join(OUT, 'hero.png'),
    1600,
    900,
    2,
    `<div class="desktop" style="left:70px;top:110px;width:1080px"><div class="bar"><i></i><i></i><i></i></div><img src="${image('desktop-dark-results')}"></div>
     <div class="phone" style="left:1170px;top:150px;width:340px"><img src="${image('phone-light-map')}"></div>`,
  );
} finally {
  await browser.close();
  await server?.close();
}
console.warn(`${String(shots.length)} images written.`);
