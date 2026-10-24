/**
 * Real-browser checks of the things jsdom cannot see: colour contrast (axe
 * with its contrast rule on, in both themes), the theme on first paint, and
 * the layout at phone, tablet and desktop widths.
 *
 * Like smoke-check.mjs it needs a running site, so it is not part of CI:
 *
 *   pnpm check:a11y
 *   pnpm check:a11y https://nsw-fuel-finder.netlify.app
 *
 * It makes no API.NSW calls. Screenshots of every width and theme go to a
 * temporary folder, printed at the end, for a person to look over.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:8888').replace(/\/$/, '');
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const SHOTS = join(tmpdir(), 'fuel-finder-a11y');
mkdirSync(SHOTS, { recursive: true });
const STORAGE_KEY = 'fuel-finder:theme:v1';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/** A page with the device in `scheme`, and `stored` as the remembered choice (or none). */
async function open(browser, { scheme = 'light', stored = null, viewport, mobile = false }) {
  const context = await browser.newContext({
    colorScheme: scheme,
    viewport: viewport ?? { width: 1280, height: 800 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  if (stored) {
    await context.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [STORAGE_KEY, stored],
    );
  }
  return { context, page: await context.newPage() };
}

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    // MapLibre's canvas is drawn pixels; axe cannot judge them, and the
    // marker colours are checked in src/styles/tokens.test.ts instead.
    const result = await window.axe.run({ exclude: [['canvas']] }, { resultTypes: ['violations'] });
    return result.violations.map(
      (v) =>
        `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')} ${v.nodes[0]?.failureSummary?.split('\n')[1] ?? ''}`,
    );
  });
  check(`axe, contrast included: ${label}`, violations.length === 0, violations.join(' | '));
}

const browser = await chromium.launch();
try {
  // --- The theme on first paint: before any of the app's JavaScript runs ----
  for (const [scheme, stored, expected] of [
    ['dark', null, 'dark'],
    ['light', 'dark', 'dark'],
    ['dark', 'light', 'light'],
    ['light', null, 'light'],
  ]) {
    const { context, page } = await open(browser, { scheme, stored });
    // Refuse the app's own scripts: what is left is what paints first.
    await page.route(/\/(assets|src)\/.*\.(js|tsx?)(\?.*)?$/, (route) => route.abort());
    await page.goto(`${BASE}/`);
    const painted = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    const dark = painted.background === 'rgb(15, 18, 22)';
    check(
      `first paint, device ${scheme}, stored ${stored ?? 'nothing'}: ${expected}`,
      painted.theme === expected && dark === (expected === 'dark'),
      `${String(painted.theme)}, ${painted.background}`,
    );
    await context.close();
  }

  // --- axe in both themes, on every state worth seeing ----------------------
  for (const theme of ['light', 'dark']) {
    const { context, page } = await open(browser, { stored: theme });
    await page.goto(`${BASE}/?fuel=U91&query=2250`);
    await page.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
    await page.locator('canvas.maplibregl-canvas').waitFor();
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading map…'), null, {
      timeout: 30_000,
    });
    await page
      .getByRole('button', { name: /^Show on map/ })
      .first()
      .click();
    await page.waitForURL(/station=/);
    await axe(page, `${theme}, wide results with map and card`);
    await page.screenshot({ path: join(SHOTS, `wide-${theme}.png`) });

    await page.goto(`${BASE}/?fuel=U91&query=Kingswood`);
    await page.getByRole('paragraph').filter({ hasText: 'Which did you mean?' }).waitFor();
    await axe(page, `${theme}, "which place?" question`);

    await page.goto(`${BASE}/?fuel=U91&query=2150&radius=25`);
    await page.getByRole('button', { name: 'Show 20 more' }).waitFor();
    await axe(page, `${theme}, long list with "Show more"`);

    // A station's price history, its table open, and favourites with one saved.
    await page
      .getByRole('button', { name: /^Favourite/ })
      .first()
      .click();
    // The list's link: the closed favourites panel now has one too.
    await page
      .getByRole('list', { name: 'Stations, cheapest first' })
      .locator('[data-history-link]')
      .first()
      .click();
    await page.getByRole('heading', { level: 2, name: /^Price history: / }).waitFor();
    await page
      .getByText(/^Lowest |^No .* price history/)
      .first()
      .waitFor();
    const table = page.getByText('Daily prices as a table');
    if (await table.isVisible()) await table.click();
    await axe(page, `${theme}, price history`);
    await page.screenshot({ path: join(SHOTS, `history-${theme}.png`), fullPage: true });
    await page.goto(`${BASE}/`);
    await page.getByRole('list', { name: /^Favourites/ }).waitFor();
    await axe(page, `${theme}, favourites`);
    await context.close();

    const phone = await open(browser, {
      stored: theme,
      viewport: { width: 375, height: 812 },
      mobile: true,
    });
    await phone.page.goto(`${BASE}/?fuel=U91&query=2250&view=map`);
    await phone.page.locator('canvas.maplibregl-canvas').waitFor();
    await axe(phone.page, `${theme}, phone map view`);
    await phone.context.close();
  }

  // --- Layout at every width: no sideways scrolling --------------------------
  const sizes = [
    ['320 phone', { width: 320, height: 640 }, true],
    ['375 phone', { width: 375, height: 812 }, true],
    ['landscape phone', { width: 812, height: 375 }, true],
    ['tablet', { width: 768, height: 1024 }, true],
    ['desktop', { width: 1280, height: 800 }, false],
  ];
  for (const [name, viewport, mobile] of sizes) {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await open(browser, { stored: theme, viewport, mobile });
      await page.goto(`${BASE}/?fuel=U91&query=2250`);
      await page.getByRole('list', { name: 'Stations, cheapest first' }).waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`${name} (${theme}): no sideways scroll`, overflow <= 0, `${String(overflow)}px`);
      const file = name.replace(/\s/g, '-');
      await page.screenshot({ path: join(SHOTS, `${file}-${theme}.png`), fullPage: true });
      const mapSwitch = page.getByRole('button', { name: 'Map', exact: true });
      if (await mapSwitch.isVisible()) {
        await mapSwitch.click();
        await page.locator('canvas.maplibregl-canvas').waitFor();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: join(SHOTS, `${file}-${theme}-map.png`) });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\nScreenshots: ${SHOTS}`);
console.log(`${results.length - failed.length} of ${results.length} checks passed against ${BASE}`);
process.exitCode = failed.length ? 1 : 0;
