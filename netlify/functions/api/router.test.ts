// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeUpstream, jsonResponse, PATHS } from './__fixtures__/fakeUpstream';
import location from './__fixtures__/location.json';
import lovs from './__fixtures__/lovs.json';
import nearby from './__fixtures__/nearby.json';
import { createHandler } from './router';

import type { ApiErrorBody, PricesResponse, ReferenceResponse } from '../../../shared/api';

const ORIGIN = 'http://localhost:8888';

function setup() {
  const upstream = fakeUpstream({
    [PATHS.reference]: [() => jsonResponse(lovs)],
    [PATHS.nearby]: [() => jsonResponse(nearby)],
    [PATHS.location]: [() => jsonResponse(location)],
  });
  const handler = createHandler(upstream.client());
  const get = (path: string, init?: RequestInit) => handler(new Request(`${ORIGIN}${path}`, init));
  return { upstream, get };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/nearby', () => {
  it('returns normalised prices with short cache headers', async () => {
    const { get } = setup();
    const response = await get('/api/nearby?lat=-33.4301&lng=151.3049&fuel=P95&radius=10');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('netlify-cdn-cache-control')).toBe(
      'public, durable, s-maxage=300, stale-while-revalidate=300',
    );

    const body = (await response.json()) as PricesResponse;
    expect(body.fuelType).toBe('P95');
    expect(body.stations.map((s) => s.name)).toEqual([
      '7-Eleven Erina',
      'Ampol Gosford',
      'BP Wyoming',
    ]);
  });

  it('forwards only the rounded position upstream', async () => {
    const { get, upstream } = setup();
    await get('/api/nearby?lat=-33.430123&lng=151.304987&fuel=P95');

    expect(upstream.dataCalls()[0]?.body).toMatchObject({ latitude: '-33.43', longitude: '151.3' });
  });

  it('refuses bad input with a 400 before spending an upstream call', async () => {
    const { get, upstream } = setup();
    const response = await get('/api/nearby?lat=-37.81&lng=144.96&fuel=P95');

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('netlify-cdn-cache-control')).toBeNull();
    expect((await response.json()) as ApiErrorBody).toEqual({
      error: { code: 'bad_request', message: 'That location is outside NSW.' },
    });
    expect(upstream.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/location', () => {
  it('returns prices for a suburb or postcode, with no distances', async () => {
    const { get } = setup();
    const response = await get('/api/location?query=2065&fuel=P95');

    expect(response.status).toBe(200);
    const body = (await response.json()) as PricesResponse;
    expect(body.stations.map((s) => [s.name, s.distanceKm])).toEqual([
      ['Caltex Crows Nest', null],
      ['BP Naremburn', null],
    ]);
  });
});

describe('GET /api/reference', () => {
  it('returns fuel types and brands with long cache headers', async () => {
    const { get } = setup();
    const response = await get('/api/reference');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('netlify-cdn-cache-control')).toContain('s-maxage=86400');
    const body = (await response.json()) as ReferenceResponse;
    expect(body.fuelTypes.map((f) => f.code)).toEqual(['E10', 'P95', 'EV']);
  });

  it('is also reachable at the function path netlify dev exposes', async () => {
    const { get } = setup();
    expect((await get('/.netlify/functions/api/reference')).status).toBe(200);
  });
});

describe('routing', () => {
  it.each(['/api', '/api/', '/api/prices', '/api/nearby/extra', '/api/../reference'])(
    '%s is a 404, not a pass-through',
    async (path) => {
      const { get, upstream } = setup();
      const response = await get(path);

      expect(response.status).toBe(404);
      expect(upstream.fetch).not.toHaveBeenCalled();
    },
  );

  it('refuses anything but GET with a 405 and an Allow header', async () => {
    const { get } = setup();
    const response = await get('/api/reference', { method: 'POST', body: '{}' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});

describe('errors', () => {
  it('maps an upstream outage to a 503 with Retry-After and no caching', async () => {
    const upstream = fakeUpstream({ [PATHS.nearby]: [() => jsonResponse({}, 503)] });
    const handler = createHandler(upstream.client());
    const response = await handler(
      new Request(`${ORIGIN}/api/nearby?lat=-33.43&lng=151.3&fuel=E10`),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(((await response.json()) as ApiErrorBody).error.code).toBe('upstream_unavailable');
  });

  it('maps an upstream credentials failure to a 502, not a 401', async () => {
    const upstream = fakeUpstream({ [PATHS.token]: [() => jsonResponse({}, 401)] });
    const handler = createHandler(upstream.client());
    const response = await handler(new Request(`${ORIGIN}/api/reference`));

    expect(response.status).toBe(502);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe('upstream_auth');
  });

  it('turns an unexpected exception into a generic 500', async () => {
    const upstream = fakeUpstream();
    const handler = createHandler(
      upstream.client({
        credentials: () => {
          throw new Error('boom');
        },
      }),
    );
    const response = await handler(new Request(`${ORIGIN}/api/reference`));

    expect(response.status).toBe(500);
    expect((await response.json()) as ApiErrorBody).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong.' },
    });
  });
});
