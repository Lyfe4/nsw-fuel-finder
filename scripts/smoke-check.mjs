/**
 * Real-browser smoke check of search, the list and the map.
 *
 * jsdom has no WebGL, so the unit suite replaces MapLibre with a recorder and
 * can only say what the app asked the map to do. This drives Chromium against
 * a running site and checks what actually happens: tiles load, dots can be
 * picked, the list and the map stay in step, and the phone layout switches.
 *
 * It needs a site with an API behind it, so it is not part of the CI gate.
 * Point it at `netlify dev` (the default) or at production:
 *
 *   pnpm check:browser
 *   pnpm check:browser https://nsw-fuel-finder.netlify.app
 *
 * It makes no API.NSW calls: the site answers from its snapshot. Against
 * production it costs a few function invocations and some OpenFreeMap tiles.
 * Uses Playwright's Chromium, as Patchbay's cross-browser check does.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:8888').replace(/\/$/, '');
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const station = (url) => new URL(url).searchParams.get('station');

const browser = await chromium.launch();
try {
  // --- Wide screen: list and map side by side --------------------------------
  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await wide.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${BASE}/?fuel=U91&query=2250`);
  const list = page.getByRole('list', { name: 'Stations, cheapest first' });
  await list.waitFor();
  check('postcode search lists stations', (await list.getByRole('listitem').count()) > 0);

  const canvas = page.locator('canvas.maplibregl-canvas');
  await canvas.waitFor();
  // The style's own layers and our dots both come from network fetches; wait
  // until MapLibre reports it has nothing left to load.
  await page.waitForFunction(() =>
    document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent?.includes('OpenStreetMap'),
  );
  await page.waitForLoadState('networkidle');
  check(
    'map shows with OpenStreetMap attribution in its corner',
    await page.locator('.maplibregl-ctrl-attrib').isVisible(),
  );

  // Suburb search, typed and submitted with Enter.
  const search = page.getByRole('combobox', { name: /suburb or postcode/i });
  await search.fill('Gosford');
  await search.press('Enter');
  await page.waitForURL(/query=Gosford/);
  await list.getByRole('listitem').first().waitFor();
  check('suburb search lists stations', (await list.getByRole('listitem').count()) > 0);

  // List -> map. Scroll first, so the map is stuck fully in view beside the
  // list and a station it shows is at its centre; then use an item on screen.
  await page.evaluate(() => {
    window.scrollTo(0, 700);
  });
  const items = list.getByRole('listitem');
  let index = 0;
  for (; index < (await items.count()); index += 1) {
    const itemBox = await items.nth(index).boundingBox();
    if (itemBox && itemBox.y > 0 && itemBox.y + itemBox.height < 800) break;
  }
  const second = items.nth(index);
  const name = await second.getByRole('heading').textContent();
  const show = second.getByRole('button', { name: /^Show on map/ });
  await show.click();
  await page.waitForURL(/station=/);
  const picked = station(page.url());
  check('"Show on map" selects the station in the URL', Boolean(picked), picked ?? '');
  check('the list item is highlighted', await second.getByText('Shown on map').isVisible());
  check('focus stays on the button', await show.evaluate((el) => el === document.activeElement));
  check(
    'the card beside the map names the station',
    (await page.locator(`h3:has-text("${name}")`).count()) === 2,
  );

  // Let the pan to the station finish before the map changes size.
  await page.waitForTimeout(1500);

  // Close, and focus returns to the list button.
  await page.getByRole('button', { name: /^Close/ }).click();
  await page.waitForURL((url) => !url.searchParams.has('station'));
  check(
    'closing the card returns focus to the list button',
    await show.evaluate((el) => el === document.activeElement),
  );

  // Map -> list. Closing the card made the map taller; MapLibre keeps the
  // same centre when it resizes, so the station's dot is at the new centre.
  // The resize and redraw take a frame or two, so try for a few seconds.
  for (let attempt = 0; attempt < 8 && !station(page.url()); attempt += 1) {
    await page.waitForTimeout(500);
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(/station=/, { timeout: 500 }).catch(() => undefined);
  }
  if (!station(page.url())) {
    const shot = join(tmpdir(), 'smoke-check-map.png');
    await page.screenshot({ path: shot });
    console.log(`      screenshot of the map: ${shot}`);
  }
  check(
    'a click on its dot selects it again',
    station(page.url()) === picked,
    station(page.url()) ?? 'none',
  );
  check(
    'and the list item is highlighted again',
    await second.getByText('Shown on map').isVisible(),
  );
  check('no console errors on the wide screen', errors.length === 0, errors.join(' | '));
  await wide.close();

  // --- Phone: one at a time, map loaded only on demand -----------------------
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/?fuel=U91&query=2250`);
  await mobile.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
  const mapButton = mobile.getByRole('button', { name: 'Map', exact: true });
  check('phone shows the List/Map switch', await mapButton.isVisible());
  const mapChunks = () =>
    mobile.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .filter((e) => /maplibre|\/StationMap[.-]/i.test(e.name)).length,
    );
  check('MapLibre is not downloaded for the list', (await mapChunks()) === 0);
  await mapButton.click();
  await mobile.locator('canvas.maplibregl-canvas').waitFor();
  check('Map shows the map, and only then downloads it', (await mapChunks()) > 0);
  check('the view is kept in the URL', new URL(mobile.url()).searchParams.get('view') === 'map');
  check(
    'the switch fits at 375px',
    await mobile.evaluate(() => document.documentElement.scrollWidth <= 375),
  );
  await phone.close();
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length} of ${results.length} checks passed against ${BASE}`,
);
process.exitCode = failed.length ? 1 : 0;
