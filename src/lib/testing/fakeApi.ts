import { vi } from 'vitest';

import type {
  ApiErrorBody,
  ApiErrorCode,
  HistoryResponse,
  StationSummary,
  StationsResponse,
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

/** A station as /api/stations and /api/history describe it, from a list entry. */
export function summary(from: StationPrice = station(), fuel = 'U91'): StationSummary {
  return {
    stationCode: from.stationCode,
    name: from.name,
    brand: from.brand,
    address: from.address,
    latitude: from.latitude,
    longitude: from.longitude,
    prices: { [fuel]: { priceCents: from.priceCents, updatedAt: from.priceUpdatedAt } },
  };
}

export function stationsResponse(
  stations: StationSummary[],
  missing: string[] = [],
): StationsResponse {
  return { fetchedAt: FETCHED_AT, stale: false, stations, missing };
}

export function historyResponse(overrides: Partial<HistoryResponse> = {}): HistoryResponse {
  return {
    fuelType: 'U91',
    station: summary(),
    days: [
      ['2026-09-29', 205.9, 209.9, 209.9],
      ['2026-09-30', 199.9, 209.9, 199.9],
      ['2026-10-23', 219.9, 224.9, 224.9],
      ['2026-10-24', 224.9, 229.9, 229.9],
    ],
    sources: [
      { kind: 'fuelcheck-monthly', from: '2026-09-29', through: '2026-09-30' },
      { kind: 'snapshots', from: '2026-10-23', through: '2026-10-24' },
    ],
    licence: 'CC BY-SA 4.0',
    ...overrides,
  };
}

export function suggestions(query: string, list: string[]): PlaceSuggestionsResponse {
  return { query, suggestions: list };
}

type Route = 'nearby' | 'location' | 'places' | 'stations' | 'history';

export function fakeApi(routes: Partial<Record<Route, Handler>> = {}) {
  const requests: { route: string; params: URLSearchParams }[] = [];
  const handlers: Record<string, Handler> = {
    location: () => json(prices()),
    nearby: () => json(prices({ origin: { latitude: -33.87, longitude: 151.21, label: null } })),
    places: (params) => json(suggestions(params.get('query') ?? '', [])),
    stations: () => json(stationsResponse([])),
    history: () => json(historyResponse()),
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
    calls: (route: Route) =>
      requests.filter((r) => r.route === route).map((r) => Object.fromEntries(r.params)),
  };
}
