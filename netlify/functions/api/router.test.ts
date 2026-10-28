// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_FETCHED_AT, fixtureSnapshot } from './__fixtures__/snapshot';
import { buildPlaceIndex } from './places';
import { createHandler } from './router';
import { SnapshotUnavailableError } from './snapshotSource';
import { NEAREST_COUNT, NEAREST_MAX_KM } from '../../../shared/api';

import type {
  ApiErrorBody,
  PlaceSuggestionsResponse,
  PricesResponse,
  StationsResponse,
  StatusResponse,
  HistoryResponse,
} from '../../../shared/api';
import type { HistoryDay } from '../../lib/snapshot/history';

const ORIGIN = 'http://localhost:8888';
const loaded = { snapshot: fixtureSnapshot, places: buildPlaceIndex(fixtureSnapshot.stations) };

function setup(
  options: {
    now?: number;
    unavailable?: boolean;
    lastRun?: unknown;
    lastRunFails?: boolean;
    history?: { backfill: unknown; live: unknown };
    day?: HistoryDay['fuels'] | null;
  } = {},
) {
  const requestedDays: string[] = [];
  const getSnapshot = vi.fn(() =>
    options.unavailable
      ? Promise.reject(new SnapshotUnavailableError('No price snapshot has been taken yet.'))
      : Promise.resolve(loaded),
  );
  const getHistory = vi.fn(() =>
    Promise.resolve(options.history ?? { backfill: null, live: null }),
  );
  const handler = createHandler({
    getSnapshot,
    getLastRun: () =>
      options.lastRunFails
        ? Promise.reject(new Error('Failed to decode token: Token expired'))
        : Promise.resolve(
            'lastRun' in options
              ? options.lastRun
              : {
                  ok: true,
                  startedAt: fixtureSnapshot.fetchedAt,
                  fetchedAt: fixtureSnapshot.fetchedAt,
                },
          ),
    getCalls: () => Promise.resolve(null),
    getHistory,
    getDay: (day) => {
      requestedDays.push(day);
      return Promise.resolve(options.day ?? null);
    },
    now: () => options.now ?? FIXTURE_FETCHED_AT + 60_000,
  });
  const get = async (path: string, init?: RequestInit) => {
    const response = await handler(new Request(`${ORIGIN}${path}`, init));
    const body: unknown = await response.json();
    return { response, body };
  };
  return { get, getSnapshot, getHistory, requestedDays };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/nearby', () => {
  // Gosford, rounded as the client sends it.
  const gosford = 'lat=-33.42&lng=151.34';

  it('returns cheapest-first prices from the snapshot, with its age', async () => {
    const { get } = setup();
    const { response, body } = await get(`/api/nearby?${gosford}&fuel=U91`);

    expect(response.status).toBe(200);
    const prices = body as PricesResponse;
    expect(prices).toMatchObject({
      fuelType: 'U91',
      fetchedAt: '2026-10-21T03:21:27.000Z',
      stale: false,
      origin: { latitude: -33.42, longitude: 151.34, label: null },
    });
    expect(prices.stations.length).toBeGreaterThan(3);
    const cents = prices.stations.map((s) => s.priceCents);
    expect(cents).toEqual([...cents].sort((a, b) => a - b));
    expect(prices.stations.every((s) => s.distanceKm <= 5.8)).toBe(true);
  });

  it('only includes stations that sell the fuel', async () => {
    const { get } = setup();
    const { body } = await get(`/api/nearby?${gosford}&fuel=B20`);
    expect((body as PricesResponse).stations).toEqual([]);
    // The one station in the fixture that does is offered as the nearest.
    expect((body as PricesResponse).nearest.map((s) => s.name)).toEqual([
      'Independent Marrickville',
    ]);
  });

  it('says how much each price has moved since yesterday, from yesterday’s day file', async () => {
    const listed = ((await setup().get(`/api/nearby?${gosford}&fuel=U91`)).body as PricesResponse)
      .stations;
    const [cheaper, dearer, same, unknown] = listed.map((s) =>
      fixtureSnapshot.stations.find((station) => station.code === s.stationCode),
    );
    if (!cheaper || !dearer || !same || !unknown) throw new Error('fixture has too few stations');
    const now = (s: typeof cheaper) => s.prices.U91?.[0] ?? 0;
    const { get, requestedDays } = setup({
      day: {
        U91: {
          [cheaper.code]: [now(cheaper), now(cheaper) + 3, now(cheaper) + 2],
          [dearer.code]: [now(dearer) - 1.5, now(dearer), now(dearer) - 1.5],
          [same.code]: [now(same), now(same), now(same)],
        },
      },
    });
    const { body } = await get(`/api/nearby?${gosford}&fuel=U91`);

    // The snapshot is from 21 Oct in Sydney, so yesterday is the 20th.
    expect(requestedDays).toEqual(['2026-10-20']);
    const change = (code: string) =>
      (body as PricesResponse).stations.find((s) => s.stationCode === code)?.changeCents;
    expect(change(cheaper.code)).toBe(-2);
    expect(change(dearer.code)).toBe(1.5);
    expect(change(same.code)).toBe(0);
    expect(change(unknown.code)).toBeNull();
  });

  it('still answers, with every change unknown, when yesterday cannot be read', async () => {
    const { get } = setup({ day: null });
    const { response, body } = await get(`/api/nearby?${gosford}&fuel=U91`);
    expect(response.status).toBe(200);
    expect((body as PricesResponse).stations.every((s) => s.changeCents === null)).toBe(true);
  });

  it('lists the nearest stations, nearest first, when none are within the distance', async () => {
    const { get } = setup();
    // Out to sea off Terrigal: nothing within 1 km.
    const { body } = await get('/api/nearby?lat=-33.45&lng=151.6&radius=1&fuel=U91');
    const prices = body as PricesResponse;

    expect(prices.stations).toEqual([]);
    // The fixture has fewer than NEAREST_COUNT within NEAREST_MAX_KM.
    expect(prices.nearest.length).toBeGreaterThan(1);
    expect(prices.nearest.length).toBeLessThanOrEqual(NEAREST_COUNT);
    const km = prices.nearest.map((s) => s.distanceKm);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    expect(km[0]).toBeGreaterThan(1);
    expect(km.at(-1)).toBeLessThanOrEqual(NEAREST_MAX_KM);
  });

  it('sends no nearest stations when the search found some', async () => {
    const { get } = setup();
    const { body } = await get(`/api/nearby?${gosford}&fuel=U91`);
    expect((body as PricesResponse).nearest).toEqual([]);
  });

  it('sets a one-minute cache at the browser and the edge', async () => {
    const { get } = setup();
    const { response } = await get(`/api/nearby?${gosford}&fuel=U91`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('netlify-cdn-cache-control')).toBe(
      'public, durable, s-maxage=60, stale-while-revalidate=60',
    );
  });

  it.each([
    [89, false],
    [91, true],
    [24 * 60, true],
  ])('at %d minutes old, stale is %s - and it is still served', async (minutes, stale) => {
    // Three missed half-hourly runs is 90 minutes.
    const { get } = setup({ now: FIXTURE_FETCHED_AT + minutes * 60_000 });
    const { response, body } = await get(`/api/nearby?${gosford}&fuel=U91`);
    expect(response.status).toBe(200);
    expect((body as PricesResponse).stale).toBe(stale);
  });

  it('refuses bad input without loading the snapshot', async () => {
    const { get, getSnapshot } = setup();
    const { response, body } = await get('/api/nearby?lat=-37.81&lng=144.96&fuel=U91');

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((body as ApiErrorBody).error.code).toBe('bad_request');
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

describe('GET /api/location', () => {
  it('resolves a suburb from the ABS list and measures from its centre', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Erina&fuel=U91');

    expect(response.status).toBe(200);
    const prices = body as PricesResponse;
    expect(prices.origin).toMatchObject({ label: 'Erina NSW 2250', latitude: -33.4373 });
    expect(prices.stations.some((s) => /erina/i.test(s.address))).toBe(true);
  });

  it('finds a suburb with no station of its own, and searches around it', async () => {
    // The gap the ABS list closes: Bondi Beach has no fuel station.
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Bondi%20Beach&fuel=U91');

    expect(response.status).toBe(200);
    expect((body as PricesResponse).origin.label).toBe('Bondi Beach NSW 2026');
  });

  it('resolves the start of a name when it can only mean one place', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Wagga&fuel=U91');

    expect(response.status).toBe(200);
    expect((body as PricesResponse).origin.label).toBe('Wagga Wagga NSW 2650');
  });

  it('resolves a postcode', async () => {
    const { get } = setup();
    const { body } = await get('/api/location?query=2715&fuel=U91');
    expect((body as PricesResponse).origin.label).toBe('2715');
    expect((body as PricesResponse).stations.length).toBeGreaterThan(0);
    expect((body as PricesResponse).stations.every((s) => /BALRANALD/i.test(s.address))).toBe(true);
  });

  it('places a postcode with no station at its ABS postal area', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=2026&fuel=U91');
    expect(response.status).toBe(200);
    expect((body as PricesResponse).origin.label).toBe('2026');
  });

  it("counts a town's stations as in it even when they are far from its centre", async () => {
    // Every Balranald station is in the result, measured from the ABS centre.
    const { get } = setup();
    const { body } = await get('/api/location?query=balranald&fuel=U91');
    expect((body as PricesResponse).stations.map((s) => s.address)).toContain(
      '94 Sturt Hwy Balranald NSW 2715', // its suburb mended from the gazetteer
    );
  });

  it('lists every place a repeated name could mean', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Kingswood&fuel=U91');

    expect(response.status).toBe(409);
    expect((body as ApiErrorBody).error).toEqual({
      code: 'ambiguous_location',
      message: 'There is more than one Kingswood.',
      candidates: [
        'Kingswood (Bega Valley) NSW 2550',
        'Kingswood (Penrith) NSW 2747',
        'Kingswood (Tamworth Regional) NSW 2340',
      ],
    });
  });

  it('accepts a candidate back as the query', async () => {
    const { get } = setup();
    const { response, body } = await get(
      `/api/location?query=${encodeURIComponent('Kingswood (Penrith) NSW 2747')}&fuel=U91`,
    );

    expect(response.status).toBe(200);
    expect((body as PricesResponse).origin.label).toBe('Kingswood (Penrith) NSW 2747');
    expect((body as PricesResponse).stations.map((s) => s.address)).toContain(
      '127 GREAT WESTERN HWY, KINGSWOOD NSW 2747',
    );
  });

  it.each([
    ['a state', 'Griffith ACT', 'Griffith ACT 2603'],
    ['a postcode', 'Griffith 2680', 'Griffith NSW 2680'],
    ['a qualifier', 'Kingswood (Penrith)', 'Kingswood (Penrith) NSW 2747'],
  ])('narrows a repeated name by %s', async (_, query, label) => {
    const { get } = setup();
    const { body } = await get(`/api/location?query=${encodeURIComponent(query)}&fuel=E10`);
    expect((body as PricesResponse).origin.label).toBe(label);
  });

  it('says so when a place is not in NSW or the ACT', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Atlantis&fuel=U91');

    expect(response.status).toBe(404);
    expect((body as ApiErrorBody).error).toEqual({
      code: 'location_not_found',
      message: "We couldn't find Atlantis in NSW or the ACT.",
    });
  });
});

describe('GET /api/places', () => {
  const suggest = async (query: string) => {
    const { get } = setup();
    const { response, body } = await get(`/api/places?query=${encodeURIComponent(query)}`);
    return { response, body: body as PlaceSuggestionsResponse };
  };

  it('suggests places by name, best match first', async () => {
    const { body } = await suggest('wagga');
    expect(body.query).toBe('wagga');
    expect(body.suggestions[0]).toBe('Wagga Wagga NSW 2650');
    expect(body.suggestions).toContain('North Wagga Wagga NSW 2650');
  });

  it('offers every Kingswood, told apart', async () => {
    const { body } = await suggest('Kingswood');
    expect(body.suggestions.slice(0, 3)).toEqual([
      'Kingswood (Bega Valley) NSW 2550',
      'Kingswood (Penrith) NSW 2747',
      'Kingswood (Tamworth Regional) NSW 2340',
    ]);
  });

  it('reads digits as the start of a postcode', async () => {
    const { body } = await suggest('2026');
    expect(body.suggestions).toContain('Bondi Beach NSW 2026');
  });

  it('ignores case, accents, full stops and Mt for Mount', async () => {
    expect((await suggest('ST. IVES')).body.suggestions[0]).toBe('St Ives NSW 2075');
    expect((await suggest('mt druitt')).body.suggestions[0]).toBe('Mount Druitt NSW 2770');
  });

  it('returns at most eight, and none for odd input rather than an error', async () => {
    expect((await suggest('b')).body.suggestions).toHaveLength(8);
    const { response, body } = await suggest('<>');
    expect(response.status).toBe(200);
    expect(body.suggestions).toEqual([]);
  });

  it('is cached for a day at the edge, because it only changes with a deploy', async () => {
    const { response } = await suggest('erina');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('netlify-cdn-cache-control')).toBe(
      'public, durable, s-maxage=86400',
    );
  });
});

describe('routing and failures', () => {
  it.each(['/api', '/api/', '/api/reference', '/api/nearby/extra'])('%s is a 404', async (path) => {
    const { get } = setup();
    expect((await get(path)).response.status).toBe(404);
  });

  it('answers only at /api/*, the path its rate limit covers', async () => {
    const { get } = setup();
    expect(
      (await get('/.netlify/functions/api/location?query=2715&fuel=U91')).response.status,
    ).toBe(404);
  });

  it('refuses anything but GET with a 405 and an Allow header', async () => {
    const { get } = setup();
    const { response } = await get('/api/nearby', { method: 'POST', body: '{}' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('reports a missing snapshot as a 503 with Retry-After, never cached', async () => {
    const { get } = setup({ unavailable: true });
    const { response, body } = await get('/api/location?query=2715&fuel=U91');

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((body as ApiErrorBody).error.code).toBe('snapshot_unavailable');
  });
});

describe('GET /api/status', () => {
  it('is 200 and never cached when the API serves what the last run wrote', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/status');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body as StatusResponse).toMatchObject({
      healthy: true,
      served: { fetchedAt: fixtureSnapshot.fetchedAt },
      lastRun: { ok: true },
    });
  });

  it('is 503 when a newer snapshot was written but an older one is served', async () => {
    const written = new Date(FIXTURE_FETCHED_AT + 30 * 60_000).toISOString();
    const { get } = setup({
      now: FIXTURE_FETCHED_AT + 45 * 60_000,
      lastRun: { ok: true, startedAt: written, fetchedAt: written },
    });
    const { response, body } = await get('/api/status');
    expect(response.status).toBe(503);
    expect((body as StatusResponse).problems[0]).toMatch(/^The API is serving the snapshot from/);
  });

  it('is 503, not an error, when there is no snapshot at all', async () => {
    const { get } = setup({ unavailable: true, lastRun: null });
    const { response, body } = await get('/api/status');
    expect(response.status).toBe(503);
    expect((body as StatusResponse).served).toBeNull();
  });

  it('is 503 when the run record cannot be read, without publishing why', async () => {
    const { get } = setup({ lastRunFails: true });
    const { response, body } = await get('/api/status');
    expect(response.status).toBe(503);
    expect((body as StatusResponse).problems).toEqual(['Could not read the last run record.']);
    expect(JSON.stringify(body)).not.toContain('Token expired');
  });
});

describe('GET /api/stations', () => {
  const code = () => fixtureSnapshot.stations[0]?.code ?? '';

  it('returns the asked-for stations with every fuel they sell, in order, and names the missing', async () => {
    const { get } = setup();
    const { response, body } = await get(`/api/stations?codes=nope,${code()}`);
    expect(response.status).toBe(200);
    const result = body as StationsResponse;
    expect(result.stations.map((s) => s.stationCode)).toEqual([code()]);
    expect(result.missing).toEqual(['nope']);
    expect(Object.keys(result.stations[0]?.prices ?? {}).length).toBeGreaterThan(0);
    expect(result.fetchedAt).toBe(fixtureSnapshot.fetchedAt);
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toContain('s-maxage=60');
  });

  it('refuses no codes, too many codes, and things that are not codes', async () => {
    const { get, getSnapshot } = setup();
    const many = Array.from({ length: 51 }, (_, i) => String(i)).join(',');
    for (const query of ['', `codes=${many}`, 'codes=<script>']) {
      const { response } = await get(`/api/stations?${query}`);
      expect(response.status).toBe(400);
    }
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

describe('GET /api/history', () => {
  const station = () => fixtureSnapshot.stations[0]?.code ?? '';
  const file = (
    source: 'fuelcheck-monthly' | 'snapshots',
    rows: [string, number, number, number][],
    through: string,
  ) => ({
    version: 2,
    code: station(),
    source,
    from: rows[0]?.[0] ?? through,
    through,
    fuels: { U91: rows },
  });

  it('joins the published history and our own, published first, with both credited', async () => {
    const { get } = setup({
      history: {
        backfill: file(
          'fuelcheck-monthly',
          [
            ['2026-09-29', 200, 205, 201],
            ['2026-09-30', 201, 201, 201],
          ],
          '2026-09-30',
        ),
        live: file(
          'snapshots',
          [
            ['2026-09-30', 1, 1, 1],
            ['2026-10-20', 210, 212, 211],
          ],
          '2026-10-20',
        ),
      },
    });
    const { response, body } = await get(`/api/history?station=${station()}&fuel=U91`);
    expect(response.status).toBe(200);
    const result = body as HistoryResponse;
    expect(result.days).toEqual([
      ['2026-09-29', 200, 205, 201],
      ['2026-09-30', 201, 201, 201],
      ['2026-10-20', 210, 212, 211],
    ]);
    expect(result.sources).toEqual([
      { kind: 'fuelcheck-monthly', from: '2026-09-29', through: '2026-09-30' },
      { kind: 'snapshots', from: '2026-10-20', through: '2026-10-20' },
    ]);
    expect(result.licence).toContain('CC BY-SA');
    expect(result.station.stationCode).toBe(station());
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toContain('s-maxage=600');
  });

  it('keeps only the last 120 days, and is empty (not an error) with no history yet', async () => {
    const old = file(
      'fuelcheck-monthly',
      [
        ['2026-06-01', 190, 190, 190],
        ['2026-06-24', 191, 191, 191],
      ],
      '2026-06-24',
    );
    const { get } = setup({ history: { backfill: old, live: null } });
    const { body } = await get(`/api/history?station=${station()}&fuel=U91`);
    expect((body as HistoryResponse).days.map(([day]) => day)).toEqual(['2026-06-24']);

    const empty = setup();
    const { response, body: none } = await empty.get(`/api/history?station=${station()}&fuel=U91`);
    expect(response.status).toBe(200);
    expect((none as HistoryResponse).days).toEqual([]);
  });

  it('ignores a history file that is for another station or unreadable', async () => {
    const { get } = setup({
      history: {
        backfill: {
          ...file('fuelcheck-monthly', [['2026-10-01', 1, 1, 1]], '2026-10-01'),
          code: 'other',
        },
        live: 'junk',
      },
    });
    const { body } = await get(`/api/history?station=${station()}&fuel=U91`);
    expect((body as HistoryResponse).days).toEqual([]);
  });

  it('is a 404 for a station FuelCheck no longer lists, and a 400 for bad input', async () => {
    const { get } = setup();
    expect((await get('/api/history?station=99999999&fuel=U91')).response.status).toBe(404);
    expect((await get('/api/history?station=&fuel=U91')).response.status).toBe(400);
    expect((await get(`/api/history?station=${station()}&fuel=XX`)).response.status).toBe(400);
  });
});

/*
 * The CDN keys a function's response on every query parameter by default, so
 * `&x=1` would be a fresh function invocation each time. Each route names the
 * parameters its answer depends on; anything else shares their cache entry.
 */
describe('cache keys', () => {
  const code = () => fixtureSnapshot.stations[0]?.code ?? '';

  it.each([
    ['/api/nearby?lat=-33.42&lng=151.34&fuel=U91', 'query=fuel|lat|lng|radius'],
    ['/api/location?query=2250&fuel=U91', 'query=fuel|query|radius'],
    ['/api/places?query=gos', 'query=query'],
    [`/api/stations?codes=${code()}`, 'query=codes'],
    [`/api/history?station=${code()}&fuel=U91`, 'query=fuel|station'],
  ])('%s varies only on its own parameters', async (path, vary) => {
    const { get } = setup();
    const { response } = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Netlify-Vary')).toBe(vary);
  });
});

describe('Blobs reads an unknown station could cost', () => {
  it('reads no history files for a station the snapshot does not have', async () => {
    const { get, getHistory } = setup();
    const { response } = await get('/api/history?station=no-such-station&fuel=U91');
    expect(response.status).toBe(404);
    expect(getHistory).not.toHaveBeenCalled();
  });
});
