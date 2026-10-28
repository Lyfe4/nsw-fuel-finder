/**
 * Renders the direction mockups to PNG with the project's Playwright:
 *
 *   node docs/design-directions/render.mjs
 *
 * For each direction, the List and Map screens at phone width (390 px, 2x)
 * in both themes, a 4-up sheet of them, and a sheet comparing the three
 * List screens. Also a legibility strip of each direction's price face.
 * Mockups only: static files, nothing from src/ or the API.
 */
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(DIR, 'png');
const DIRECTIONS = ['a-price-board', 'b-road-atlas', 'c-docket'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });

const shots = {};
for (const name of DIRECTIONS) {
  for (const theme of ['light', 'dark']) {
    await page.goto(pathToFileURL(join(DIR, `${name}.html`)).href);
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForSelector('body[data-ready="1"]');
    for (const screen of ['list', 'map']) {
      const file = join(OUT, `${name}-${screen}-${theme}.png`);
      await page.locator(`#${screen}`).screenshot({ path: file });
      (shots[name] ??= []).push(file);
    }
  }
}

await page.setViewportSize({ width: 1800, height: 1000 });

/** A sheet of images side by side, with captions. */
async function sheet(file, title, items) {
  const cells = items
    .map(
      ([src, caption]) =>
        `<figure><img src="${pathToFileURL(src).href}" width="390"><figcaption>${caption}</figcaption></figure>`,
    )
    .join('');
  await page.setContent(
    `<style>body{margin:0;padding:24px;background:#3a3a38;font:14px/1.4 Arial,sans-serif;color:#eee}h1{font-size:18px;margin:0 0 16px}main{display:flex;gap:20px}figure{margin:0}figcaption{margin-top:8px}</style><h1>${title}</h1><main>${cells}</main>`,
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.locator('body').screenshot({ path: file });
}

const LABELS = {
  'a-price-board': 'A. Price Board',
  'b-road-atlas': 'B. Road Atlas',
  'c-docket': 'C. Docket',
};
for (const name of DIRECTIONS) {
  const [listLight, mapLight, listDark, mapDark] = shots[name];
  await sheet(join(OUT, `${name}-sheet.png`), `${LABELS[name]}, phone (390 px)`, [
    [listLight, 'List, light'],
    [listDark, 'List, dark'],
    [mapLight, 'Map, light'],
    [mapDark, 'Map, dark'],
  ]);
}
for (const theme of ['light', 'dark']) {
  const index = theme === 'light' ? 0 : 2;
  await sheet(
    join(OUT, `compare-list-${theme}.png`),
    `The three directions, List screen, ${theme}`,
    DIRECTIONS.map((name) => [shots[name][index], LABELS[name]]),
  );
}

await page.setViewportSize({ width: 900, height: 400 });
await page.goto(pathToFileURL(join(DIR, 'legibility.html')).href);
await page.waitForSelector('body[data-ready="1"]');
await page.locator('main').screenshot({ path: join(OUT, 'legibility.png') });

/*
 * What a screen reader is given for a station's price: the accessibility
 * tree's text for the first row in each direction.
 */
for (const name of DIRECTIONS) {
  await page.goto(pathToFileURL(join(DIR, `${name}.html`)).href);
  await page.waitForSelector('body[data-ready="1"]');
  const snapshot = await page.locator('#list li').first().ariaSnapshot();
  console.log(`\n${LABELS[name]}, first row as a screen reader gets it:\n${snapshot}`);
}

await browser.close();
console.log(`\nWrote ${OUT}`);
