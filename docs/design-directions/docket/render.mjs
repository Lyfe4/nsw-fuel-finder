/**
 * Renders the round 2 Docket mockups to PNG:
 *
 *   node docs/design-directions/docket/render.mjs
 *
 * Phone (List, Map, History) and desktop (results, History), both themes,
 * at 2x, plus one sheet per width and theme.
 */
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(DIR, 'png');
const PAGES = {
  phone: ['list', 'map', 'history'],
  desktop: ['results', 'history'],
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
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

await page.setViewportSize({ width: 2700, height: 1000 });
for (const [key, items] of Object.entries(shots)) {
  const width = key.startsWith('phone') ? 390 : 1280;
  const cells = items
    .map(
      ([src, caption]) =>
        `<figure><img src="${pathToFileURL(src).href}" width="${width}"><figcaption>${caption}</figcaption></figure>`,
    )
    .join('');
  await page.setContent(
    `<style>body{margin:0;padding:24px;background:#3a3a38;font:14px/1.4 Arial,sans-serif;color:#eee;width:max-content}h1{font-size:18px;margin:0 0 16px}main{display:flex;gap:20px}figure{margin:0}figcaption{margin-top:8px}</style><h1>Docket, ${key}</h1><main>${cells}</main>`,
  );
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.locator('body').screenshot({ path: join(OUT, `sheet-${key}.png`) });
}

await browser.close();
console.log(`Wrote ${OUT}`);
