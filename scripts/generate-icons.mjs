/**
 * Draws the favicon and app icons: public/favicon.svg, and PNGs rasterised
 * from it with Playwright's Chromium (already a dev dependency, for the
 * browser checks). The mark is the docket (docs/design-system.md): a strip
 * of paper torn along its top, on ink, with two printed lines and the
 * cheapest in carbon blue. Colours are read from src/styles/tokens.css so
 * they cannot drift from the design.
 *
 * Run with `pnpm assets:icons`. The output is committed: it changes only when
 * the design does, and a fresh clone should not need a browser to have a
 * favicon. Mirrors Patchbay's scripts/generate-assets.mjs, smaller.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const tokens = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');

function palette(name) {
  const value = new RegExp(`--palette-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)?.[1];
  if (!value) throw new Error(`--palette-${name} not found in tokens.css`);
  return value;
}

const INK = palette('ink');
const PAPER = palette('thermal');
const ACCENT = palette('carbon-700');

/**
 * `inset` is the share of the square left as margin: maskable icons are
 * cropped to a circle by Android, so they need more. Square corners but for
 * a 3-unit radius, as the app's controls have; none for maskable icons,
 * whose shape the platform decides.
 */
function mark(inset = 0) {
  const scale = 1 - inset * 2;
  const offset = 32 * inset;
  // The paper: 8 to 24 across, torn in four teeth along the top at y 6 to 8.
  const torn = 'M8 8 L10 6 L12 8 L14 6 L16 8 L18 6 L20 8 L22 6 L24 8 L24 27 L8 27 Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${inset ? 0 : 3}" fill="${INK}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${torn}" fill="${PAPER}"/>
    <rect x="11" y="12" width="10" height="2" fill="${INK}"/>
    <rect x="11" y="16.5" width="7" height="2" fill="${INK}"/>
    <rect x="11" y="21" width="10" height="3" fill="${ACCENT}"/>
  </g>
</svg>
`;
}

writeFileSync(join(PUBLIC, 'favicon.svg'), mark());

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, size, inset] of [
    ['favicon-32.png', 32, 0],
    ['apple-touch-icon.png', 180, 0.08],
    ['icon-192.png', 192, 0],
    ['icon-512.png', 512, 0],
    ['icon-maskable-512.png', 512, 0.12],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0">${mark(inset).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: join(PUBLIC, file), omitBackground: true });
    console.warn(`  public/${file}`);
  }
} finally {
  await browser.close();
}
