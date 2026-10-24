import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAPLIBRE_WORKER_URL,
  mapStyleUrl,
  resetWarmedForTests,
  warmMapResources,
} from './mapStyle';

const STYLE = {
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/ne/{z}/{x}/{y}.png'] },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'water', type: 'fill' },
    { id: 'place', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } },
    { id: 'road', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } },
    { id: 'water-name', type: 'symbol', layout: { 'text-font': ['Noto Sans Italic'] } },
  ],
};

function stubFetch(style: unknown = STYLE, ok = true) {
  const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(style), { status: ok ? 200 : 503 })),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Lets the chain of promises inside warmMapResources finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  resetWarmedForTests();
});

describe('warmMapResources', () => {
  it('fetches the worker, the style, its tile index and every font it labels with, in parallel with MapLibre', async () => {
    const fetch = stubFetch();
    warmMapResources('light');
    await settle();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      MAPLIBRE_WORKER_URL,
      mapStyleUrl('light'),
      'https://tiles.openfreemap.org/planet',
      'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf',
      'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf',
      'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Italic/0-255.pbf',
    ]);
  });

  it('fetches the worker only once, whichever theme comes first', async () => {
    const fetch = stubFetch();
    warmMapResources('light');
    warmMapResources('dark');
    await settle();
    expect(fetch.mock.calls.filter(([url]) => url === MAPLIBRE_WORKER_URL)).toHaveLength(1);
    expect(fetch.mock.calls.map(([url]) => url)).toContain(mapStyleUrl('dark'));
  });

  it('only once per theme', async () => {
    const fetch = stubFetch();
    warmMapResources('dark');
    warmMapResources('dark');
    await settle();
    expect(fetch.mock.calls.filter(([url]) => url === mapStyleUrl('dark'))).toHaveLength(1);
  });

  it('gives up quietly when the style cannot be fetched', async () => {
    const fetch = stubFetch(STYLE, false);
    warmMapResources('light');
    await settle();
    // The worker and the style: nothing the failed style would have named.
    expect(fetch).toHaveBeenCalledTimes(2);

    resetWarmedForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    expect(() => {
      warmMapResources('light');
    }).not.toThrow();
    await settle();
  });
});
