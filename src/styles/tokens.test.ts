import { describe, expect, it } from 'vitest';

import tokens from './tokens.css?raw';

/*
 * Guards for the token layer:
 * - CSS modules never write a colour of their own, so dark mode stays a
 *   token-only change;
 * - the dark theme re-points every colour the light one sets;
 * - every text/background pair the UI uses meets WCAG AA, in both themes;
 * - the map's price bands stay distinguishable with colour blindness.
 */

const modules = import.meta.glob<string>('../**/*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function declarations(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) map.set(name, value.trim());
  }
  return map;
}

/** The declarations inside the block that starts with `selector {`. */
function block(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No "${selector}" block in tokens.css`);
  const end = tokens.indexOf('\n}', start);
  return declarations(tokens.slice(start, end));
}

const light = block(':root');
const dark = block(":root[data-theme='dark']");

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];

/** A token's value in a theme: dark overrides first, then the root block. */
function resolve(name: string, theme: Theme, seen = new Set<string>()): string {
  const value = (theme === 'dark' ? dark.get(name) : undefined) ?? light.get(name);
  if (value === undefined) throw new Error(`${name} is not defined in tokens.css`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!reference) return value;
  if (seen.has(reference)) throw new Error(`Circular token ${reference}`);
  return resolve(reference, theme, seen.add(reference));
}

function linear(hex: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = (hex.replace('#', '').match(/../g) ?? []).map((pair) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string, theme: Theme): number {
  const a = luminance(linear(resolve(foreground, theme)));
  const b = luminance(linear(resolve(background, theme)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/*
 * Colour-blindness simulation: Machado, Oliveira and Fernandes (2009), full
 * severity, applied to linear RGB. Distance is CIE76 ΔE in CIELAB, where
 * about 2 is just noticeable and 20 or more is "clearly a different colour".
 */
type Matrix = [[number, number, number], [number, number, number], [number, number, number]];
const VISION: Record<string, Matrix> = {
  typical: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function lab(hex: string, vision: Matrix): [number, number, number] {
  const c = linear(hex);
  const [r, g, b] = vision.map((row) =>
    Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])),
  ) as [number, number, number];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function distance(a: string, b: string, theme: Theme, vision: Matrix): number {
  const p = lab(resolve(a, theme), vision);
  const q = lab(resolve(b, theme), vision);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const PAIRS: [string, string, number][] = [
  ['--color-text', '--color-bg', 4.5],
  ['--color-text', '--color-surface', 4.5],
  ['--color-text-muted', '--color-surface', 4.5],
  ['--color-text-muted', '--color-bg', 4.5],
  // Primary buttons and the pressed List/Map switch.
  ['--color-on-ink', '--color-ink', 4.5],
  ['--color-ink', '--color-surface', 4.5],
  ['--color-ink', '--color-bg', 4.5],
  // The cheapest price and "Cheapest", a price's move today, the cheapest map tag.
  ['--color-on-accent', '--color-accent', 4.5],
  ['--color-accent', '--color-surface', 4.5],
  ['--color-accent', '--color-bg', 4.5],
  ['--color-accent', '--color-highlight', 4.5],
  // The active place suggestion, the map's loading placeholder, the loading skeleton.
  ['--color-text', '--color-highlight', 4.5],
  ['--color-text-muted', '--color-highlight', 4.5],
  ['--color-danger', '--color-surface', 4.5],
  ['--color-danger', '--color-bg', 4.5],
  // An old price is warning text on a station row, on paper or the counter.
  ['--color-warning', '--color-surface', 4.5],
  ['--color-warning', '--color-bg', 4.5],
  // Non-text: the focus ring and control borders need 3:1 (WCAG 1.4.11).
  ['--color-focus', '--color-surface', 3],
  ['--color-focus', '--color-bg', 3],
  ['--color-border-strong', '--color-surface', 3],
  // Map markers and labels on the basemap's land, water and parks.
  ...['--color-map-land', '--color-map-water', '--color-map-green'].flatMap(
    (ground): [string, string, number][] => [
      ['--color-price-low', ground, 3],
      ['--color-price-mid', ground, 3],
      ['--color-price-high', ground, 3],
      ['--color-map-origin', ground, 3],
      ['--color-marker-selected', ground, 3],
    ],
  ),
  // The price beside a dot is text, on its own halo.
  ['--color-text', '--color-surface', 4.5],
];

describe('design tokens', () => {
  it('found the CSS modules to check', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(modules))('%s writes no colour of its own', (_, css) => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|--palette-/i);
  });

  it.each(Object.entries(modules))('%s uses only tokens that exist', (_, css) => {
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name ?? '');
    // Custom properties a module sets for itself are its own business.
    const own = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
    const missing = used.filter((name) => !own.has(name) && !light.has(name));
    expect(missing).toEqual([]);
  });

  it('dark mode re-points every colour token, and only colour tokens', () => {
    const lightColours = [...light.keys()].filter((name) => name.startsWith('--color-')).sort();
    expect([...dark.keys()].sort()).toEqual(lightColours);
  });

  it('dark mode only points at primitives defined once, at the root', () => {
    for (const value of dark.values()) {
      const reference = /^var\((--palette-[\w-]+)\)$/.exec(value)?.[1];
      expect(reference, value).toBeDefined();
      expect(light.has(reference ?? '')).toBe(true);
    }
  });

  describe.each(THEMES)('%s theme', (theme) => {
    it.each(PAIRS)('%s on %s meets %d:1', (foreground, background, minimum) => {
      expect(contrast(foreground, background, theme)).toBeGreaterThanOrEqual(minimum);
    });

    it.each(Object.entries(VISION))(
      'price bands stay clearly different with %s vision',
      (_, vision) => {
        const bands = ['--color-price-low', '--color-price-mid', '--color-price-high'];
        for (const [i, a] of bands.entries()) {
          for (const b of bands.slice(i + 1)) {
            expect(distance(a, b, theme, vision), `${a} / ${b}`).toBeGreaterThanOrEqual(20);
          }
        }
      },
    );
  });
});
