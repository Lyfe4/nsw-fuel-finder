/**
 * Renders the minimal Docket mockups to PNG:
 *
 *   node docs/design-directions/minimal/render.mjs
 *
 * Phone (List, a station selected, search reopened, Map, History) and
 * desktop (results, History) in both themes at 2x; one sheet per width
 * and theme; the before/after of the phone list (before = production on
 * 28 October, png/before-phone-list.png); and what a screen reader gets
 * for a row, written to png/screen-reader.txt.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(DIR, 'png');
const PAGES = {
  phone: ['list', 'selected', 'search', 'map', 'history'],
  desktop: ['results', 'history'],
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 2200, height: 900 },
  deviceScaleFactor: 2,
});

const shots = {};
for (const [name, screens] of Object.entries(PAGES)) {
  for (const theme of ['light', 'dark']) {
    await page.goto(pathToFileURL(join(DIR, `${name}.html`)).href);
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForSelector('body[data-ready="1"]');
    for (const screen of screens) {
      const file = join(OUT, `${name}-${screen}-${theme}.png`);
      await page.locator(`#${screen}`).screenshot({ path: file });
      (shots[`${name}-${theme}`] ??= []).push([file, `${screen}, ${theme}`]);
    }
  }
}

/* What assistive technology is given: the accessibility tree. */
await page.goto(pathToFileURL(join(DIR, 'phone.html')).href);
await page.waitForSelector('body[data-ready="1"]');
const report = [];
for (const [title, selector] of [
  ['A row (closed)', '#list li.station >> nth=0'],
  ['An old price', '#list li.station >> nth=1'],
  ['A selected row (open)', '#selected li.station.open'],
  ['The summary', '#list .summary'],
  ['The collapsed search', '#list .searched'],
  ['The map card', '#map .mapcard'],
]) {
  report.push(`${title}:\n${await page.locator(selector).ariaSnapshot()}\n`);
}
writeFileSync(join(OUT, 'screen-reader.txt'), report.join('\n'));

async function sheet(file, title, items, width) {
  const cells = items
    .map(
      ([src, caption]) =>
        `<figure><img src="${pathToFileURL(src).href}" width="${width}"><figcaption>${caption}</figcaption></figure>`,
    )
    .join('');
  await page.setViewportSize({ width: 2800, height: 1000 });
  await page.setContent(
    `<style>body{margin:0;padding:24px;background:#3a3a38;font:14px/1.4 Arial,sans-serif;color:#eee;width:max-content}h1{font-size:18px;margin:0 0 16px}main{display:flex;gap:20px;align-items:flex-start}figure{margin:0}figcaption{margin-top:8px;max-width:${width}px}</style><h1>${title}</h1><main>${cells}</main>`,
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.locator('body').screenshot({ path: file });
}

for (const [key, items] of Object.entries(shots)) {
  await sheet(
    join(OUT, `sheet-${key}.png`),
    `Docket, minimal: ${key}`,
    items,
    key.startsWith('phone') ? 390 : 1280,
  );
}
await sheet(
  join(OUT, 'before-after-phone-list.png'),
  'Phone list after a search, 390 × 844: before (production, 28 Oct) and after',
  [
    [join(OUT, 'before-phone-list.png'), 'Before: the first price is below this screen'],
    [join(OUT, 'phone-list-light.png'), 'After: eight full stations, first price at 243 px'],
    [join(OUT, 'phone-list-dark.png'), 'After, dark'],
  ],
  390,
);

await browser.close();
console.log(`Wrote ${OUT}`);
