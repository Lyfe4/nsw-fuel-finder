import type {
  ApiErrorBody,
  ApiErrorCode,
  HistoryResponse,
  PlaceSuggestionsResponse,
  PricesResponse,
  StationsResponse,
} from '../../shared/api';

/** Anything that went wrong talking to /api/*, in one shape the UI can switch on. */
export class ApiRequestError extends Error {
  /** HTTP status, or 0 when the request never got a response (offline, DNS, abort). */
  readonly status: number;
  /** The API's error code, or 'network' / 'unexpected' for failures that are not its. */
  readonly code: ApiErrorCode | 'network' | 'unexpected';
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

/** GET /api/nearby or /api/location. Parameter names match the API exactly. */
export function fetchPrices({ fuel, radius, place }: PriceSearch, signal?: AbortSignal) {
  const common = { fuel, radius: String(radius) };
  return place.kind === 'nearby'
    ? getJson<PricesResponse>(
        '/api/nearby',
        { lat: String(place.lat), lng: String(place.lng), ...common },
        signal,
      )
    : getJson<PricesResponse>('/api/location', { query: place.query, ...common }, signal);
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
