import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

import type { Theme } from '@/features/theme/theme';

/*
 * Kept out of StationMap so LazyStationMap can use it without pulling in
 * MapLibre: the warm-up below has to start before MapLibre has downloaded.
 */

/**
 * MapLibre finds its worker next to its own file, which is not where Vite
 * puts it. `?url` makes Vite emit the (self-contained) worker as a hashed
 * asset and hands us its address: only a string, so importing it here costs
 * the first page load nothing.
 */
export const MAPLIBRE_WORKER_URL = workerUrl;

/**
 * OpenFreeMap: no key, no account, no request limit, OpenStreetMap data, and
 * a light and a dark style from the same tiles. Attribution comes from the
 * style and is shown uncollapsed in the map corner. See docs/decisions.md,
 * "Map tiles".
 */
const STYLE_URLS: Record<Theme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** Our price labels' font (StationMap's `text-font`). */
export const LABEL_FONT = 'Noto Sans Bold';

export function mapStyleUrl(theme: Theme): string {
  return STYLE_URLS[theme];
}

interface StyleJson {
  sources?: Record<string, { url?: unknown }>;
  glyphs?: unknown;
  layers?: { layout?: { 'text-font'?: unknown } }[];
}

/** Every font the style labels with, and ours: MapLibre asks for each one separately. */
function fontStacks(style: StyleJson): string[] {
  const stacks = new Set([LABEL_FONT]);
  for (const layer of style.layers ?? []) {
    const font = layer.layout?.['text-font'];
    if (Array.isArray(font) && font.every((name) => typeof name === 'string')) {
      stacks.add(font.join(','));
    }
  }
  return [...stacks];
}

const warmed = new Set<Theme>();

/**
 * Fetches what MapLibre will ask for first, while MapLibre itself is still
 * downloading. On its own, MapLibre loads in a chain: its code, then the
 * style, then the tile index the style names, then tiles and fonts. Measured
 * on a throttled phone profile that chain was most of the map's first load.
 * Every one of these responses is public and cacheable (OpenFreeMap sends
 * `Cache-Control: public, max-age`), so when MapLibre asks, the browser
 * answers from its cache.
 *
 * Only what the map needs anyway, only once per theme, and never an error:
 * if a fetch fails, MapLibre simply asks again itself.
 */
export function warmMapResources(theme: Theme): void {
  if (warmed.has(theme) || typeof fetch !== 'function') return;
  const quietly = (url: string) => fetch(url).catch(() => undefined);
  // MapLibre's worker, which it only asks for once its own code has run.
  if (warmed.size === 0) void quietly(MAPLIBRE_WORKER_URL);
  warmed.add(theme);
  void fetch(mapStyleUrl(theme))
    .then((response) => (response.ok ? (response.json() as Promise<StyleJson>) : null))
    .then((style) => {
      if (!style) return;
      for (const source of Object.values(style.sources ?? {})) {
        if (typeof source.url === 'string') void quietly(source.url);
      }
      const glyphs = style.glyphs;
      if (typeof glyphs !== 'string') return;
      // 0-255: Latin, which is every label in NSW.
      for (const stack of fontStacks(style)) {
        void quietly(
          glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', '0-255'),
        );
      }
    })
    .catch(() => undefined);
}

/** For tests. */
export function resetWarmedForTests(): void {
  warmed.clear();
}
