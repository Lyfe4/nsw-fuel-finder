import type {
  ApiErrorBody,
  ApiErrorCode,
  HistoryResponse,
  PlaceSuggestionsResponse,
  PricesResponse,
  StationPrice,
  StationsResponse,
} from '../../shared/api';

/** Anything that went wrong talking to /api/*, in one shape the UI can switch on. */
export class ApiRequestError extends Error {
  /** HTTP status, or 0 when the request never got a response (offline, DNS, abort). */
  readonly status: number;
  /**
   * The API's error code, or one for failures that are not its: 'network'
   * (no response), 'rate_limited' (Netlify's edge refused the request, 429)
   * or 'unexpected'.
   */
  readonly code: ApiErrorCode | 'network' | 'rate_limited' | 'unexpected';
  readonly candidates: readonly string[];

  constructor(
    status: number,
    code: ApiRequestError['code'],
    message: string,
    candidates: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.candidates = candidates;
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiErrorBody).error.code === 'string'
  );
}

async function getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const url = `${path}?${new URLSearchParams(params).toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: signal ?? null,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    // Let TanStack Query see its own cancellations as cancellations.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'network', 'Could not reach the server.');
  }

  // The rate limit on /api/* (netlify/functions/api/api.ts) is applied by
  // Netlify's edge, whose 429 is not our JSON.
  if (response.status === 429) {
    throw new ApiRequestError(429, 'rate_limited', 'Too many requests from this network.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && body !== null) return body as T;
  if (isErrorBody(body)) {
    throw new ApiRequestError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.candidates ?? [],
    );
  }
  throw new ApiRequestError(response.status, 'unexpected', 'The server sent an unexpected reply.');
}

export interface PriceSearch {
  fuel: string;
  radius: number;
  place: { kind: 'nearby'; lat: number; lng: number } | { kind: 'location'; query: string };
}

/**
 * A prices answer from before round 8, which had no `nearest` or
 * `changeCents`. For a minute or so after a deploy the browser's own cache
 * (max-age=60) can still hand one to the new code.
 */
type PricesOnTheWire = Omit<PricesResponse, 'nearest' | 'stations'> & {
  nearest?: PricesResponse['nearest'];
  stations: (Omit<StationPrice, 'changeCents'> & { changeCents?: number | null })[];
};

function normalisePrices(body: PricesOnTheWire): PricesResponse {
  return {
    ...body,
    stations: body.stations.map((station) => ({
      ...station,
      changeCents: station.changeCents ?? null,
    })),
    nearest: body.nearest ?? [],
  };
}

/** GET /api/nearby or /api/location. Parameter names match the API exactly. */
export async function fetchPrices({ fuel, radius, place }: PriceSearch, signal?: AbortSignal) {
  const common = { fuel, radius: String(radius) };
  const body =
    place.kind === 'nearby'
      ? await getJson<PricesOnTheWire>(
          '/api/nearby',
          { lat: String(place.lat), lng: String(place.lng), ...common },
          signal,
        )
      : await getJson<PricesOnTheWire>('/api/location', { query: place.query, ...common }, signal);
  return normalisePrices(body);
}

/** GET /api/places?query= */
export function fetchPlaceSuggestions(query: string, signal?: AbortSignal) {
  return getJson<PlaceSuggestionsResponse>('/api/places', { query }, signal);
}

/**
 * GET /api/stations?codes= for favourites. Sorted, so the same favourites in
 * any order share one cache entry at the edge.
 */
export function fetchStations(codes: readonly string[], signal?: AbortSignal) {
  const sorted = [...codes].sort((a, b) => a.localeCompare(b)).join(',');
  return getJson<StationsResponse>('/api/stations', { codes: sorted }, signal);
}

/** GET /api/history?station=&fuel= */
export function fetchHistory(station: string, fuel: string, signal?: AbortSignal) {
  return getJson<HistoryResponse>('/api/history', { station, fuel }, signal);
}
