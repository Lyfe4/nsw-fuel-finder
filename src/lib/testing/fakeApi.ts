import { vi } from 'vitest';

import type {
  ApiErrorBody,
  ApiErrorCode,
  PlaceSuggestionsResponse,
  PricesResponse,
  StationPrice,
} from '../../../shared/api';

/**
 * A stand-in for /api/* at the fetch boundary. Each route answers with a
 * function of the request's search params; every request is recorded.
 */
type Handler = (params: URLSearchParams) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const apiError = (
  status: number,
  code: ApiErrorCode,
  message: string,
  candidates?: string[],
) => {
  const body: ApiErrorBody = {
    error: { code, message, ...(candidates ? { candidates } : {}) },
  };
  return json(body, status);
};

/** The snapshot time the fake prices claim: 2:30 pm in Sydney on 23 Oct 2026. */
export const FETCHED_AT = '2026-10-23T03:30:00.000Z';

export function station(overrides: Partial<StationPrice> = {}): StationPrice {
  return {
    stationCode: '1',
    name: 'Ampol Foodary Erina',
    brand: 'Ampol',
    address: '155 The Entrance Rd, ERINA NSW 2250',
    latitude: -33.437,
    longitude: 151.394,
    distanceKm: 0.4,
    priceCents: 229.9,
    priceUpdatedAt: '2026-10-23T00:30:00Z',
    ...overrides,
  };
}

export function prices(overrides: Partial<PricesResponse> = {}): PricesResponse {
  return {
    fuelType: 'U91',
    fetchedAt: FETCHED_AT,
    stale: false,
    origin: { latitude: -33.4373, longitude: 151.3938, label: 'Erina NSW 2250' },
    stations: [
      station(),
      station({
        stationCode: '2',
        name: 'Metro Petroleum West Gosford',
        brand: 'Metro',
        address: '57 Central Coast Hwy, WEST GOSFORD NSW 2250',
        distanceKm: 4.2,
        priceCents: 231.9,
      }),
    ],
    ...overrides,
  };
}

export function suggestions(query: string, list: string[]): PlaceSuggestionsResponse {
  return { query, suggestions: list };
}

export function fakeApi(routes: Partial<Record<'nearby' | 'location' | 'places', Handler>> = {}) {
  const requests: { route: string; params: URLSearchParams }[] = [];
  const handlers: Record<string, Handler> = {
    location: () => json(prices()),
    nearby: () => json(prices({ origin: { latitude: -33.87, longitude: 151.21, label: null } })),
    places: (params) => json(suggestions(params.get('query') ?? '', [])),
    ...routes,
  };

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input, 'http://localhost');
    const route = url.pathname.replace(/^\/api\//, '');
    requests.push({ route, params: url.searchParams });
    const handler = handlers[route];
    if (!handler) return Promise.resolve(apiError(404, 'not_found', 'No such endpoint.'));
    return Promise.resolve(handler(url.searchParams));
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    fetch: fetchMock,
    requests,
    /** The search params of every request to one route, oldest first. */
    calls: (route: 'nearby' | 'location' | 'places') =>
      requests.filter((r) => r.route === route).map((r) => Object.fromEntries(r.params)),
  };
}
