// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_FETCHED_AT, fixtureSnapshot } from './__fixtures__/snapshot';
import { buildPlaceIndex } from './places';
import { createHandler } from './router';
import { SnapshotUnavailableError } from './snapshotSource';

import type { ApiErrorBody, PricesResponse } from '../../../shared/api';

const ORIGIN = 'http://localhost:8888';
const loaded = { snapshot: fixtureSnapshot, places: buildPlaceIndex(fixtureSnapshot.stations) };

function setup(options: { now?: number; unavailable?: boolean } = {}) {
  const getSnapshot = vi.fn(() =>
    options.unavailable
      ? Promise.reject(new SnapshotUnavailableError('No price snapshot has been taken yet.'))
      : Promise.resolve(loaded),
  );
  const handler = createHandler({
    getSnapshot,
    now: () => options.now ?? FIXTURE_FETCHED_AT + 60_000,
  });
  const get = async (path: string, init?: RequestInit) => {
    const response = await handler(new Request(`${ORIGIN}${path}`, init));
    const body: unknown = await response.json();
    return { response, body };
  };
  return { get, getSnapshot };
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
  it('resolves a suburb and measures from its centre', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Erina&fuel=U91');

    expect(response.status).toBe(200);
    const prices = body as PricesResponse;
    expect(prices.origin.label).toBe('Erina NSW 2250');
    expect(prices.stations.some((s) => s.address.includes('ERINA'))).toBe(true);
    // Wyoming is 4 km from Erina's centre, inside the default 5 km; West
    // Gosford is 5.4 km away, outside it.
    expect(prices.stations.some((s) => s.address.includes('WYOMING'))).toBe(true);
    expect(prices.stations.some((s) => s.address.includes('WEST GOSFORD'))).toBe(false);
  });

  it('resolves a postcode', async () => {
    const { get } = setup();
    const { body } = await get('/api/location?query=2715&fuel=U91');
    expect((body as PricesResponse).origin.label).toBe('2715');
    expect((body as PricesResponse).stations.length).toBeGreaterThan(0);
    expect((body as PricesResponse).stations.every((s) => /BALRANALD/i.test(s.address))).toBe(true);
  });

  it('finds an address that had no comma before its suburb', async () => {
    const { get } = setup();
    const { body } = await get('/api/location?query=balranald&fuel=U91');
    expect((body as PricesResponse).stations.map((s) => s.address)).toContain(
      '94 Sturt Hwy BALRANALD NSW 2715',
    );
  });

  it('asks which one when a suburb name means two places', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Griffith&fuel=U91');

    expect(response.status).toBe(409);
    expect((body as ApiErrorBody).error).toEqual({
      code: 'ambiguous_location',
      message: 'There is more than one Griffith.',
      candidates: ['Griffith ACT 2603', 'Griffith NSW 2680'],
    });
  });

  // E10: the Griffith ACT station sells no U91.
  it('accepts a candidate back as the query', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Griffith%20ACT%202603&fuel=E10');

    expect(response.status).toBe(200);
    expect((body as PricesResponse).origin.label).toBe('Griffith ACT 2603');
    expect((body as PricesResponse).stations.map((s) => s.address)).toContain(
      '77 CANBERRA AV, GRIFFITH ACT 2603',
    );
  });

  it('does not count an EV charger as a second place', async () => {
    // Live data has a "Kingswood NSW 2340" near Tamworth, but it is an EV
    // charger with no fuel price, so only Penrith's Kingswood is a place.
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Kingswood&fuel=U91');

    expect(response.status).toBe(200);
    expect((body as PricesResponse).origin.label).toBe('Kingswood NSW 2747');
  });

  it('says so when no station is listed in a place', async () => {
    const { get } = setup();
    const { response, body } = await get('/api/location?query=Woy%20Woy&fuel=U91');

    expect(response.status).toBe(404);
    expect((body as ApiErrorBody).error.code).toBe('location_not_found');
  });
});

describe('routing and failures', () => {
  it.each(['/api', '/api/', '/api/reference', '/api/nearby/extra'])('%s is a 404', async (path) => {
    const { get } = setup();
    expect((await get(path)).response.status).toBe(404);
  });

  it('is reachable at the function path netlify dev exposes', async () => {
    const { get } = setup();
    expect(
      (await get('/.netlify/functions/api/location?query=2715&fuel=U91')).response.status,
    ).toBe(200);
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
