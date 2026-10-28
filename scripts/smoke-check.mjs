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

/**
 * Whether Netlify's free-plan badge is on the page. Netlify stopped serving it
 * (round 9), and the CSP was tightened to match: it no longer allows the
 * badge's inline styles or script. If Netlify starts serving it again, it
 * would be silently broken, so this check fails instead and says why.
 */
function badgePresent(page) {
  return page.evaluate(() =>
    Boolean(
      document.getElementById('nl-badge-frame') ??
      document.querySelector('script[src*="/.netlify/scripts/hud"]'),
    ),
  );
}

/**
 * Runs in the page before anything else: every CSP refusal, kept for the
 * checks. The console also logs them, but this names the directive and URL.
 */
function recordViolations() {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
  });
}

/**
 * Runs in the page before anything else: the layout shift (CLS) not caused by
 * input, as Lighthouse counts it. Round 10 fixed a 0.053 on wide screens (the
 * footer pushed down when the results replaced the loading cards).
 */
function recordLayoutShift() {
  window.__layoutShift = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__layoutShift += entry.value;
    }
  }).observe({ type: 'layout-shift', buffered: true });
}

/**
 * Waits for the list's cards to finish arriving (a 180 ms rise and fade).
 * Clicked mid-animation, Playwright finds the button "not stable" and retries
 * with a forced scroll alignment, which moves the page under the checks that
 * follow. The infinite loading pulses are left out: they never finish.
 */
const settled = (page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );

/** How many of MapLibre's files the page has fetched, and from OpenFreeMap. */
const mapFetches = (page) =>
  page.evaluate(() => {
    const names = performance.getEntriesByType('resource').map((e) => e.name);
    return {
      chunks: names.filter((name) => /maplibre|\/StationMap[.-]/i.test(name)).length,
      tiles: names.filter((name) => name.includes('openfreemap')).length,
    };
  });
const mapChunks = async (page) => (await mapFetches(page)).chunks;

/**
 * Whether this browser draws WebGL in software, as src/features/map/mapStart.ts
 * decides it. Headless Chromium uses SwiftShader, here and on CI's runners,
 * so the wide map waits for "Show the map"; with a GPU it starts by itself.
 */
const softwareWebGL = (page) =>
  page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  });

/**
 * Taps or clicks the map at spots away from its centre (and from the zoom
 * buttons and attribution) until the selection clears. A spot may hold
 * another station, which picking it selects; the next spot tries again.
 * Returns which try cleared it, or 0.
 */
async function tapNothing(page, canvas, tap) {
  const box = await canvas.boundingBox();
  const spots = [
    [0.15, 0.2],
    [0.6, 0.2],
    [0.15, 0.75],
    [0.6, 0.75],
    [0.35, 0.45],
    [0.15, 0.45],
  ];
  for (const [index, [fx, fy]] of spots.entries()) {
    await tap(box.x + box.width * fx, box.y + box.height * fy);
    await page
      .waitForURL((url) => !url.searchParams.has('station'), { timeout: 1500 })
      .catch(() => undefined);
    if (!station(page.url())) return index + 1;
  }
  return 0;
}

/** Real touch input, through the DevTools protocol: Playwright itself can only tap. */
function touchInput(session) {
  const send = (type, points) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  /** Fingers from `from` to `to` (one [x, y] each), in ten moves. */
  return async (from, to) => {
    await send('touchStart', from);
    for (let step = 1; step <= 10; step += 1) {
      await send(
        'touchMove',
        from.map(([x, y], i) => [
          x + ((to[i][0] - x) * step) / 10,
          y + ((to[i][1] - y) * step) / 10,
        ]),
      );
    }
    await send('touchEnd', []);
  };
}

const browser = await chromium.launch();
try {
  // --- Wide screen: list and map side by side --------------------------------
  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await wide.addInitScript(recordViolations);
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
  if (await softwareWebGL(page)) {
    // Software WebGL: the map waits to be asked, so the list is not blocked
    // while MapLibre compiles its shaders (round 11).
    const showMap = page.getByRole('button', { name: 'Show the map' });
    await showMap.waitFor();
    const before = await mapFetches(page);
    check(
      'without a GPU the wide map waits for "Show the map", having fetched nothing',
      before.chunks === 0 && before.tiles === 0,
      `${String(before.chunks)} MapLibre files, ${String(before.tiles)} OpenFreeMap requests`,
    );
    await showMap.click();
    await canvas.waitFor();
    await page
      .waitForFunction(
        () => document.activeElement?.classList.contains('maplibregl-canvas'),
        null,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    check(
      '"Show the map" starts it, and focus goes to the map',
      await canvas.evaluate((el) => el === document.activeElement),
    );
  } else {
    await canvas.waitFor();
    check('with a GPU the wide map starts by itself', true);
  }
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
  await page.getByText('Loading map…').waitFor({ state: 'detached', timeout: 30_000 });
  check('the "Loading map…" placeholder clears once the map has drawn', true);

  // Layout shift while the results load, at Lighthouse's desktop and mobile
  // sizes. The prices are held back a second and a half, as on a slow
  // phone, so the loading state is on screen long enough to be measured: on
  // a fast connection the results replaced it before it painted, and
  // PageSpeed's mobile run saw the footer move (0.266) when this did not.
  for (const [name, viewport] of [
    ['desktop', { width: 1350, height: 940 }],
    ['phone', { width: 412, height: 823 }],
  ]) {
    const shiftContext = await browser.newContext({ viewport });
    await shiftContext.addInitScript(recordLayoutShift);
    await shiftContext.route('**/api/location**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const shiftPage = await shiftContext.newPage();
    await shiftPage.goto(`${BASE}/?fuel=U91&query=2250`);
    await shiftPage.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
    await shiftPage.waitForLoadState('networkidle');
    const shift = await shiftPage.evaluate(() => window.__layoutShift);
    check(
      `nothing moves while the results load, ${name} (CLS under 0.01)`,
      shift < 0.01,
      shift.toFixed(3),
    );
    await shiftContext.close();
  }

  // Suburb search, typed and submitted with Enter.
  const search = page.getByRole('combobox', { name: /suburb or postcode/i });
  await search.fill('Gosford');
  await search.press('Enter');
  await page.waitForURL(/query=Gosford/);
  await list.getByRole('listitem').first().waitFor();
  await settled(page);
  check('suburb search lists stations', (await list.getByRole('listitem').count()) > 0);
  await canvas.waitFor();
  check(
    'the map stays for the next search, without asking again',
    (await page.getByRole('button', { name: 'Show the map' }).count()) === 0,
  );

  // List -> map. Scroll first, so the map is fully in view beside the list
  // and a station it shows is at its centre; then use an item on screen.
  // To the map's own top, not a fixed distance: the rows are one line now,
  // and a fixed scroll took a short list (and its sticky map) past its end.
  await page.evaluate(() => {
    const map = document.querySelector('canvas.maplibregl-canvas');
    if (map) window.scrollTo(0, map.getBoundingClientRect().top + window.scrollY - 16);
  });
  const items = list.getByRole('listitem');
  let index = 0;
  for (; index < (await items.count()); index += 1) {
    const itemBox = await items.nth(index).boundingBox();
    if (itemBox && itemBox.y > 0 && itemBox.y + itemBox.height < 800) break;
  }
  const second = items.nth(index);
  // The row: a heading holding one button, which opens the station's card.
  const show = second.getByRole('heading').getByRole('button');
  const isOpen = () => show.evaluate((el) => el.getAttribute('aria-expanded') === 'true');
  const cards = () => page.getByRole('button', { name: /^Close/ }).count();
  await show.click();
  await page.waitForURL(/station=/);
  const picked = station(page.url());
  check('a station’s row selects it in the URL', Boolean(picked), picked ?? '');
  check('the row opens, with its card under it', (await isOpen()) && (await cards()) === 1);
  check('focus stays on the row', await show.evaluate((el) => el === document.activeElement));

  const badge = await badgePresent(page);
  check(
    'Netlify’s badge is not served (the CSP no longer allows it)',
    !badge,
    badge
      ? 'it is back and the CSP blocks it: allow it again, or remove it; see docs/decisions.md, round 9'
      : '',
  );

  // Let the pan to the station finish before the map changes size.
  await page.waitForTimeout(1500);

  // Close, and focus returns to the list button.
  await page.getByRole('button', { name: /^Close/ }).click();
  await page.waitForURL((url) => !url.searchParams.has('station'));
  check(
    'closing the card returns focus to the station’s row',
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
  check('and its row opens again', await isOpen());

  // Escape on the map clears the selection; the map keeps focus.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await page
    .waitForURL((url) => !url.searchParams.has('station'), { timeout: 2000 })
    .catch(() => undefined);
  check(
    'Escape on the map clears the selection, focus staying on the map',
    !station(page.url()) && (await canvas.evaluate((el) => el === document.activeElement)),
  );

  // Selected again from the list. A drag is not a click: still selected.
  await show.click();
  await page.waitForURL(/station=/);
  await page.waitForTimeout(1500);
  const dragBox = await canvas.boundingBox();
  await page.mouse.move(dragBox.x + dragBox.width * 0.3, dragBox.y + dragBox.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width * 0.5, dragBox.y + dragBox.height * 0.4, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(800);
  check('dragging the map keeps the selection', station(page.url()) === picked);

  // A click on empty map clears it, and the card goes.
  const cleared = await tapNothing(page, canvas, (x, y) => page.mouse.click(x, y));
  check(
    'a click on the map away from the stations clears the selection',
    cleared > 0,
    cleared ? `spot ${String(cleared)}` : 'every spot tried held a station',
  );
  check('and closes the card', (await cards()) === 0 && !(await isOpen()));

  // Selected again, for the checks that follow.
  await show.click();
  await page.waitForURL((url) => url.searchParams.get('station') === picked);
  await page.waitForTimeout(1500);
  // Dark mode swaps the basemap, and the stations are drawn on it again.
  const darkStyle = page.waitForRequest(/tiles\.openfreemap\.org\/styles\/dark/);
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await darkStyle;
  await page.waitForLoadState('networkidle');
  check(
    'choosing Dark darkens the page and loads the dark basemap',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
  );
  check(
    'the station is still selected on the dark map',
    station(page.url()) === picked && (await isOpen()),
  );
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('system');

  // A big search lists 20, and more on request.
  await page.goto(`${BASE}/?fuel=U91&query=2150&radius=25`);
  await list.getByRole('listitem').first().waitFor();
  check(
    'a 25 km Sydney search lists 20 at first',
    (await list.getByRole('listitem').count()) === 20,
  );
  await page.getByRole('button', { name: 'Show 20 more' }).click();
  check('"Show 20 more" lists 40', (await list.getByRole('listitem').count()) === 40);
  check(
    'and focus moves to the 21st station',
    await page.evaluate(() => document.activeElement?.parentElement?.tagName === 'H3'),
  );

  // Distance: four steps, in the URL.
  const within = page.getByRole('combobox', { name: 'Within' });
  check(
    'the distance offers 2, 5, 10 and 25 km',
    (await within.locator('option').allTextContents()).join() === '2 km,5 km,10 km,25 km',
  );
  await within.selectOption('10');
  await page.waitForURL(/radius=10/);
  await list.getByRole('listitem').first().waitFor();
  check('choosing 10 km searches again, kept in the URL', true);

  // Round 8: the summary sentence, sort, filters and directions.
  check(
    'the summary is a few words beside the heading, and one sentence for screen readers',
    (await page.getByText(/^(save \$[\d.]+ on 50 L|average [\d.]+)$/).isVisible()) &&
      (await page
        .getByText(/^Cheapest [\d.]+, average [\d.]+ cents a litre\./)
        .evaluate((el) => el.getAttribute('aria-hidden') === null)),
  );
  const sort = page.getByRole('combobox', { name: 'Sort' });
  await sort.selectOption('distance');
  await page.waitForURL(/sort=distance/);
  const nearest = page.getByRole('list', { name: 'Stations, nearest first' });
  const kms = await nearest.evaluate((el) =>
    [...el.querySelectorAll(':scope > li')].map((li) => {
      const [, value, unit] = /([\d.]+) (k?m) away/.exec(li.textContent ?? '') ?? [];
      return Number(value) / (unit === 'm' ? 1000 : 1);
    }),
  );
  check(
    'Nearest first sorts by distance, kept in the URL',
    kms.length > 1 && kms.every((km, i) => i === 0 || km >= kms[i - 1]),
  );
  await sort.selectOption('price');
  await page.getByText('Filters', { exact: true }).click();
  const firstBrand = page.getByRole('group', { name: 'Brands' }).getByRole('checkbox').first();
  const brandLabel = (await firstBrand.locator('xpath=..').textContent()) ?? '';
  const brandCount = Number(/\((\d+)\)$/.exec(brandLabel)?.[1]);
  await firstBrand.check();
  await page.waitForURL(/brand=/);
  // The row no longer shows the brand (its card does): count the rows instead.
  const rows = await list.getByRole('listitem').count();
  check(
    'ticking a brand lists only that brand’s stations, kept in the URL',
    rows > 0 && rows === Math.min(brandCount, 20),
    `${brandLabel}: ${String(rows)}`,
  );
  check(
    'the heading says how many of how many',
    /^\d+ of \d+ stations? within/.test(
      (await page.getByRole('heading', { level: 2 }).first().textContent()) ?? '',
    ),
  );
  check(
    'and focus stays on the checkbox',
    await firstBrand.evaluate((el) => el === document.activeElement),
  );
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForURL((url) => !url.searchParams.has('brand'));
  // Directions, the star and the history link are in a station's card.
  await list.getByRole('heading').first().getByRole('button').click();
  await page.waitForURL(/station=/);
  const directions = list
    .getByRole('link', { name: /^Directions to .*, opens in a new tab$/ })
    .first();
  check(
    'each station has directions, opening a maps app in a new tab',
    (await directions.getAttribute('target')) === '_blank' &&
      /^https:\/\/(www\.google\.com\/maps\/dir\/|maps\.apple\.com\/)/.test(
        (await directions.getAttribute('href')) ?? '',
      ),
  );

  // Favourites: star the cheapest, see it in the panel with a price.
  // Chromium names it "Favourite , <station>" (a space for the hidden span).
  const star = list.getByRole('button', { name: /^Favourite/ }).first();
  await star.click();
  check(
    'the star is a pressed toggle once saved',
    (await star.getAttribute('aria-pressed')) === 'true',
  );
  check(
    'the favourites panel counts it',
    await page.getByText('Favourites (1)', { exact: true }).isVisible(),
  );

  // Price history: from the station's name, published history and our own joined.
  const firstLink = list.locator('[data-history-link]').first();
  await firstLink.click();
  await page.waitForURL(/history=/);
  const historyHeading = page.getByRole('heading', { level: 2, name: /^Price history: / });
  await historyHeading.waitFor();
  check(
    'the history view opens with focus on its heading',
    await historyHeading.evaluate((el) => el === document.activeElement),
  );
  await page.getByText(/^Lowest in the last \d+ days/).waitFor({ timeout: 15_000 });
  check('it says the lowest and highest in words', true);
  const slider = page.getByRole('slider');
  check('the chart is there, as a slider over the days', await slider.isVisible());
  check(
    'the published FuelCheck history is credited',
    await page
      .getByRole('region', { name: /^Price history/ })
      .getByRole('link', { name: 'NSW FuelCheck price history' })
      .isVisible(),
  );
  check(
    'it lists every fuel the station sells',
    await page.getByRole('table', { name: 'Every fuel here now, cents a litre' }).isVisible(),
  );
  await slider.focus();
  await page.keyboard.press('Home');
  check(
    'Home goes to the first day',
    (await slider.getAttribute('aria-valuenow')) === '1',
    (await slider.getAttribute('aria-valuetext')) ?? '',
  );
  await page.goBack();
  await page.waitForURL((url) => !url.searchParams.has('history'));
  check(
    'Back closes it, and focus returns to the station link',
    await firstLink.evaluate((el) => el === document.activeElement),
  );
  // Leave no favourite behind in this browser profile.
  await star.click();

  // Nothing within the distance: the nearest stations, not a dead end.
  await page.goto(`${BASE}/?fuel=U91&query=Mount%20Hope&radius=25`);
  const nearestHeading = page.getByRole('heading', { level: 2, name: /^Nearest stations, / });
  await nearestHeading.waitFor();
  check(
    'a place with nothing within 25 km lists the nearest stations instead',
    (await page
      .getByRole('list', { name: 'Stations, nearest first' })
      .getByRole('listitem')
      .count()) > 0,
    (await nearestHeading.textContent()) ?? '',
  );

  // The clear button in the suburb box.
  await page.getByRole('button', { name: 'Clear suburb or postcode' }).click();
  check(
    'the clear button empties the suburb box and leaves focus in it',
    (await search.inputValue()) === '' &&
      (await search.evaluate((el) => el === document.activeElement)),
  );

  // Very wide: the search form is one row above the results.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${BASE}/?fuel=U91&query=2150&radius=10`);
  await list.getByRole('listitem').first().waitFor();
  const form = await page.getByRole('search').boundingBox();
  const listBox = await list.boundingBox();
  check(
    'at 1600 px the search form is one row above the results',
    Boolean(form && listBox) && form.height < 120 && form.y + form.height <= listBox.y,
  );
  await page.setViewportSize({ width: 1280, height: 800 });

  check('no console errors on the wide screen', errors.length === 0, errors.join(' | '));
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  check('no Content-Security-Policy violations', violations.length === 0, violations.join(' | '));
  await wide.close();

  // --- Phone: one at a time, map loaded only on demand -----------------------
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
  await phone.addInitScript(recordViolations);
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/?fuel=U91&query=2250`);
  await mobile.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
  const mapButton = mobile.getByRole('button', { name: 'Map', exact: true });
  check('phone shows the List/Map switch', await mapButton.isVisible());
  check(
    'on a phone the search folds into one line after a search, the fuel still a select',
    (await mobile.getByRole('button', { name: 'Change search' }).isVisible()) &&
      (await mobile.getByRole('combobox', { name: 'Fuel' }).isVisible()) &&
      !(await mobile.getByRole('combobox', { name: /suburb or postcode/i }).isVisible()),
  );
  check(
    'the first price is on the first screen',
    (
      (await mobile
        .getByRole('list', { name: 'Stations, cheapest first' })
        .getByRole('heading')
        .first()
        .boundingBox()) ?? { y: Infinity }
    ).y < 500,
  );
  check('MapLibre is not downloaded for the list', (await mapChunks(mobile)) === 0);
  await mapButton.click();
  await mobile.locator('canvas.maplibregl-canvas').waitFor();
  check('Map shows the map, and only then downloads it', (await mapChunks(mobile)) > 0);
  check('the view is kept in the URL', new URL(mobile.url()).searchParams.get('view') === 'map');
  check(
    'the switch fits at 375px',
    await mobile.evaluate(() => document.documentElement.scrollWidth <= 375),
  );
  await mobile.getByText('Loading map…').waitFor({ state: 'detached', timeout: 30_000 });

  // Touch: drags, pinches and double-taps keep the selection; a tap on
  // nothing clears it.
  await mobile.getByRole('button', { name: 'List', exact: true }).click();
  await mobile
    .getByRole('list', { name: 'Stations, cheapest first' })
    .getByRole('heading')
    .first()
    .getByRole('button')
    .click();
  await mobile.waitForURL(/station=/);
  check(
    'on a phone a row opens its card in the list, without switching to the map',
    new URL(mobile.url()).searchParams.get('view') === null,
  );
  await mapButton.click();
  await mobile.waitForTimeout(1500);
  const phoneCanvas = mobile.locator('canvas.maplibregl-canvas');
  const phoneBox = await phoneCanvas.boundingBox();
  const at = (fx, fy) => [phoneBox.x + phoneBox.width * fx, phoneBox.y + phoneBox.height * fy];
  const gesture = touchInput(await phone.newCDPSession(mobile));
  await gesture([at(0.3, 0.6)], [at(0.5, 0.4)]);
  await gesture([at(0.4, 0.5), at(0.6, 0.5)], [at(0.25, 0.5), at(0.75, 0.5)]);
  await mobile.waitForTimeout(800);
  check(
    'on a phone, dragging and pinching the map keep the selection',
    Boolean(station(mobile.url())),
  );
  const [doubleX, doubleY] = at(0.3, 0.3);
  await mobile.touchscreen.tap(doubleX, doubleY);
  await mobile.touchscreen.tap(doubleX, doubleY);
  await mobile.waitForTimeout(800);
  // The first tap may land on another station and pick it; it must not clear.
  check('a double-tap (a zoom) keeps a selection', Boolean(station(mobile.url())));
  const tapped = await tapNothing(mobile, phoneCanvas, (x, y) => mobile.touchscreen.tap(x, y));
  check(
    'a tap on the map away from the stations clears it and closes the card',
    tapped > 0 && (await mobile.getByRole('button', { name: /^Close/ }).count()) === 0,
    tapped ? `spot ${String(tapped)}` : 'every spot tried held a station',
  );
  check(
    'the phone stays on the map',
    new URL(mobile.url()).searchParams.get('view') === 'map' && (await phoneCanvas.isVisible()),
  );

  const phoneViolations = await mobile.evaluate(() => window.__cspViolations ?? []);
  check(
    'no Content-Security-Policy violations on the phone map',
    phoneViolations.length === 0,
    phoneViolations.join(' | '),
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
