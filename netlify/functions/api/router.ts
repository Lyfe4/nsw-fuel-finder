import { ApiError, errorResponse, json } from './http';
import { resolvePlace } from './places';
import { searchNearby, searchPlace } from './search';
import { SnapshotUnavailableError, type LoadedSnapshot } from './snapshotSource';
import { historyBody, parseStationCode, parseStationCodes, stationsBody } from './stations';
import { statusReport } from './status';
import { parseFuelType, parseLocationQuery, parseNearbyQuery } from './validate';
import { suggestPlaces } from '../../lib/places/gazetteer';
import { STALE_AFTER_MS } from '../../lib/snapshot/format';

import type {
  PlaceSuggestionsResponse,
  PricesResponse,
  SearchOrigin,
  StationPrice,
} from '../../../shared/api';

/*
 * CACHING. Answers come from a snapshot that changes every 30 minutes and cost
 * no upstream calls, so the CDN is now about speed and function invocations,
 * not quota. A minute at the edge (plus a minute of stale-while-revalidate)
 * means a new snapshot is visible within about two minutes of being written,
 * and a burst of identical requests runs the function about once a minute.
 *
 * `Netlify-CDN-Cache-Control` is for Netlify's edge only and is stripped
 * before the response leaves it; `durable` shares one edge node's miss with
 * the rest. `Cache-Control` is the browser's, kept equally short.
 */
const CACHE = {
  browser: 'public, max-age=60',
  cdn: 'public, durable, s-maxage=60, stale-while-revalidate=60',
} as const;

/**
 * Suggestions come from the bundled ABS list, which only changes with a
 * deploy - and a deploy purges Netlify's CDN - so they can be cached for a
 * day at the edge and an hour in the browser.
 */
const SUGGESTION_CACHE = {
  browser: 'public, max-age=3600',
  cdn: 'public, durable, s-maxage=86400',
} as const;

/**
 * History changes once a day, when the scheduled job folds yesterday in, so
 * ten minutes at the edge costs nothing in freshness.
 */
const HISTORY_CACHE = {
  browser: 'public, max-age=600',
  cdn: 'public, durable, s-maxage=600, stale-while-revalidate=600',
} as const;

const ROUTES = ['nearby', 'location', 'places', 'status', 'stations', 'history'] as const;
type Route = (typeof ROUTES)[number];

// Reached through the /api/* rewrite or, in `netlify dev`, directly.
const PREFIX = /^\/(?:api|\.netlify\/functions\/api)\/([^/]+)\/?$/;

function matchRoute(pathname: string): Route | null {
  const name = PREFIX.exec(pathname)?.[1];
  return ROUTES.find((route) => route === name) ?? null;
}

export interface HandlerDeps {
  /** The latest scheduled run summary (meta/last-run), read strongly. */
  getLastRun: () => Promise<unknown>;
  getSnapshot: () => Promise<LoadedSnapshot>;
  /** One station's two history files (published, and our own); each null when absent. */
  getHistory: (code: string) => Promise<{ backfill: unknown; live: unknown }>;
  now: () => number;
}

function cached(body: unknown, cache: { browser: string; cdn: string }): Response {
  const response = json(body, 200, cache.browser);
  response.headers.set('Netlify-CDN-Cache-Control', cache.cdn);
  return response;
}

function respond(
  { snapshot }: LoadedSnapshot,
  now: number,
  fuelType: string,
  origin: SearchOrigin,
  stations: StationPrice[],
): Response {
  const body: PricesResponse = {
    fuelType,
    fetchedAt: snapshot.fetchedAt,
    stale: now - Date.parse(snapshot.fetchedAt) > STALE_AFTER_MS,
    origin,
    stations,
  };
  const response = json(body, 200, CACHE.browser);
  response.headers.set('Netlify-CDN-Cache-Control', CACHE.cdn);
  return response;
}

/**
 * GET /api/places?query=... - suggestions while the user types. Never an
 * error for odd input: a stray character mid-word just means no suggestions.
 */
function suggestions(params: URLSearchParams): Response {
  const query = (params.get('query') ?? '').trim().slice(0, 60);
  const body: PlaceSuggestionsResponse = { query, suggestions: suggestPlaces(query) };
  const response = json(body, 200, SUGGESTION_CACHE.browser);
  response.headers.set('Netlify-CDN-Cache-Control', SUGGESTION_CACHE.cdn);
  return response;
}

async function dispatch(route: Route, params: URLSearchParams, deps: HandlerDeps) {
  if (route === 'places') return suggestions(params);
  if (route === 'status') {
    const [served, run] = await Promise.all([
      deps.getSnapshot().then(
        (loaded) => loaded.snapshot,
        () => null,
      ),
      // A failed read is reported as such, never as "no runs".
      deps.getLastRun().then(
        (lastRun) => ({ lastRun }),
        (error: unknown) => {
          console.error('Reading meta/last-run failed', error);
          return {
            lastRun: null,
            lastRunError: error instanceof Error ? error.message : String(error),
          };
        },
      ),
    ]);
    const report = statusReport({ served, ...run, now: deps.now() });
    return json(report, report.healthy ? 200 : 503, 'no-store');
  }

  // Validate before touching the snapshot: bad input is a 400 even when the
  // snapshot is missing.
  if (route === 'stations') {
    const codes = parseStationCodes(params);
    const { snapshot } = await deps.getSnapshot();
    const stale = deps.now() - Date.parse(snapshot.fetchedAt) > STALE_AFTER_MS;
    return cached(stationsBody(snapshot, codes, stale), CACHE);
  }
  if (route === 'history') {
    const code = parseStationCode(params);
    const fuel = parseFuelType(params);
    const [{ snapshot }, files] = await Promise.all([deps.getSnapshot(), deps.getHistory(code)]);
    return cached(historyBody(snapshot, code, fuel, files), HISTORY_CACHE);
  }
  if (route === 'nearby') {
    const query = parseNearbyQuery(params);
    const loaded = await deps.getSnapshot();
    const origin = { latitude: query.latitude, longitude: query.longitude };
    const stations = searchNearby(loaded.snapshot.stations, origin, query.radiusKm, query.fuelType);
    return respond(loaded, deps.now(), query.fuelType, { ...origin, label: null }, stations);
  }

  const query = parseLocationQuery(params);
  const loaded = await deps.getSnapshot();
  const place = resolvePlace(loaded.places, query);
  const stations = searchPlace(loaded.snapshot.stations, place, query.radiusKm, query.fuelType);
  const origin = { latitude: place.latitude, longitude: place.longitude, label: place.label };
  return respond(loaded, deps.now(), query.fuelType, origin, stations);
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      const route = matchRoute(url.pathname);
      if (!route) throw new ApiError('not_found', 'No such endpoint.');
      if (request.method !== 'GET') {
        throw new ApiError('method_not_allowed', 'Only GET is supported.');
      }
      return await dispatch(route, url.searchParams, deps);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error);
      if (error instanceof SnapshotUnavailableError) {
        return errorResponse(
          new ApiError('snapshot_unavailable', 'Fuel prices are not available right now.'),
        );
      }
      console.error('Unhandled error in /api', error);
      return errorResponse(new ApiError('internal_error', 'Something went wrong.'));
    }
  };
}
