/**
 * Draws the favicon and app icons: public/favicon.svg, and PNGs rasterised
 * from it with Playwright's Chromium (already a dev dependency, for the
 * browser checks). The mark is a fuel drop in the app's accent colour, read
 * from src/styles/tokens.css so it cannot drift from the design.
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

const ACCENT = palette('teal-700');
const WHITE = palette('white');

/**
 * A drop, with a highlight. `inset` is the share of the square left as
 * margin: maskable icons are cropped to a circle by Android, so they need more.
 */
function mark(inset = 0) {
  const scale = 1 - inset * 2;
  const offset = 32 * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${inset ? 0 : 7}" fill="${ACCENT}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M16 4.5c-.6 0-1 .4-1.4 1C11.9 9.8 8 15.1 8 19.5a8 8 0 0 0 16 0c0-4.4-3.9-9.7-6.6-14-.4-.6-.8-1-1.4-1z" fill="${WHITE}"/>
    <path d="M12.6 20.2a3.6 3.6 0 0 0 3.2 3.6" fill="none" stroke="${ACCENT}" stroke-width="1.8" stroke-linecap="round"/>
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
