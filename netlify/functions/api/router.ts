import { ApiError, errorResponse, json } from './http';
import { resolvePlace } from './places';
import { searchNearby, searchNearest, searchPlace, type YesterdayPrices } from './search';
import { SnapshotUnavailableError, type LoadedSnapshot } from './snapshotSource';
import {
  assertListed,
  historyBody,
  parseStationCode,
  parseStationCodes,
  stationsBody,
} from './stations';
import { statusReport } from './status';
import { parseFuelType, parseLocationQuery, parseNearbyQuery } from './validate';
import { stationSource } from '../../../shared/api';
import { addDays } from '../../lib/history/stationHistory';
import { suggestPlaces } from '../../lib/places/gazetteer';
import { sydneyMonth } from '../../lib/snapshot/calls';
import { QLD_STALE_AFTER_MS, STALE_AFTER_MS, type Snapshot } from '../../lib/snapshot/format';
import { brisbaneDay, sydneyDay } from '../../lib/upstream/time';

import type { QldStatusInput } from './qldStatus';
import type {
  PlaceSuggestionsResponse,
  PriceSource,
  PricesResponse,
  SearchOrigin,
  SourceId,
  StationPrice,
} from '../../../shared/api';
import type { FuelTypeCode } from '../../../shared/fuelTypes';
import type { HistoryDay } from '../../lib/snapshot/history';

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

/*
 * CACHE KEYS. Netlify's CDN keys a function's response on every query
 * parameter by default (`Netlify-Vary: query`), so `?query=gos&x=1` would
 * miss the cache and run the function each time: a cheap way to spend the
 * team's monthly invocations. Each route names the parameters its answer
 * depends on; requests that differ only in anything else share an entry.
 * Parameter order is already ignored by the CDN. Names and values stay
 * case-sensitive, which is why the client sends them in one canonical form.
 */
const VARY: Record<Exclude<Route, 'status'>, string> = {
  nearby: 'query=fuel|lat|lng|radius',
  location: 'query=fuel|query|radius',
  places: 'query=query',
  stations: 'query=codes',
  history: 'query=fuel|station',
};

// The function's only path (its config in api.ts), in production and `netlify dev` alike.
const PREFIX = /^\/api\/([^/]+)\/?$/;

function matchRoute(pathname: string): Route | null {
  const name = PREFIX.exec(pathname)?.[1];
  return ROUTES.find((route) => route === name) ?? null;
}

export interface HandlerDeps {
  /** The latest scheduled run summary (meta/last-run), read strongly. */
  getLastRun: () => Promise<unknown>;
  /** This Sydney month's API.NSW call count (meta/calls/YYYY-MM), or null. */
  getCalls: (month: string) => Promise<unknown>;
  getSnapshot: () => Promise<LoadedSnapshot>;
  /** One station's two history files (published, and our own); each null when absent. */
  getHistory: (code: string) => Promise<{ backfill: unknown; live: unknown }>;
  /** A finished day's prices (history/v1/DAY), or null; never throws. */
  getDay: (day: string) => Promise<HistoryDay['fuels'] | null>;
  /** The same from Queensland's day files (qld/history/v1/DAY, Brisbane days); null while it is not public. */
  getQldDay?: (day: string) => Promise<HistoryDay['fuels'] | null>;
  /** Queensland's run record, newest snapshot, calls and reference metadata, for /api/status. */
  getQldStatus?: () => Promise<QldStatusInput>;
  /** QLD_PUBLIC (round 15): whether Queensland is served and can make /api/status unhealthy. */
  qldPublic?: boolean;
  now: () => number;
}

function cached(
  body: unknown,
  cache: { browser: string; cdn: string },
  route: keyof typeof VARY,
): Response {
  const response = json(body, 200, cache.browser);
  response.headers.set('Netlify-CDN-Cache-Control', cache.cdn);
  response.headers.set('Netlify-Vary', VARY[route]);
  return response;
}

/** Each source's own snapshot is stale after three of its own missed runs. */
const STALE_AFTER: Record<SourceId, number> = { nsw: STALE_AFTER_MS, qld: QLD_STALE_AFTER_MS };

function respond(
  route: 'nearby' | 'location',
  loaded: LoadedSnapshot,
  now: number,
  fuelType: FuelTypeCode,
  origin: SearchOrigin,
  stations: StationPrice[],
  yesterday: YesterdayPrices | undefined,
): Response {
  const { snapshot } = loaded;
  const nearest =
    stations.length === 0 ? searchNearest(snapshot.stations, origin, fuelType, yesterday) : [];
  // The sources with a station in this answer, each with its own time.
  const shown = new Set([...stations, ...nearest].map((s) => stationSource(s.stationCode)));
  const sources: PriceSource[] = (loaded.sources ?? [{ id: 'nsw', fetchedAt: snapshot.fetchedAt }])
    .filter((source) => shown.has(source.id))
    .map((source) => ({
      ...source,
      stale: now - Date.parse(source.fetchedAt) > STALE_AFTER[source.id],
    }));
  const body: PricesResponse = {
    fuelType,
    fetchedAt: snapshot.fetchedAt,
    stale:
      sources.length > 0
        ? sources.some((source) => source.stale)
        : now - Date.parse(snapshot.fetchedAt) > STALE_AFTER_MS,
    origin,
    stations,
    nearest,
    sources,
    unavailable: [...(loaded.unavailable ?? [])],
  };
  return cached(body, CACHE, route);
}

/**
 * GET /api/places?query=... - suggestions while the user types. Never an
 * error for odd input: a stray character mid-word just means no suggestions.
 */
function suggestions(params: URLSearchParams, withQld: boolean): Response {
  const query = (params.get('query') ?? '').trim().slice(0, 60);
  const body: PlaceSuggestionsResponse = { query, suggestions: suggestPlaces(query, withQld) };
  return cached(body, SUGGESTION_CACHE, 'places');
}

/**
 * NSW's own part of what is served, for /api/status's NSW checks: a merged
 * snapshot's time is the older of the two, which is not when NSW's was taken.
 */
function nswPart(loaded: LoadedSnapshot): Snapshot {
  const nsw = loaded.sources?.find((source) => source.id === 'nsw');
  if (!loaded.sources || loaded.sources.length === 1) {
    return nsw ? loaded.snapshot : { ...loaded.snapshot, stations: [] };
  }
  return {
    ...loaded.snapshot,
    fetchedAt: nsw?.fetchedAt ?? loaded.snapshot.fetchedAt,
    stations: loaded.snapshot.stations.filter((s) => stationSource(s.code) === 'nsw'),
  };
}

async function dispatch(route: Route, params: URLSearchParams, deps: HandlerDeps) {
  if (route === 'places') return suggestions(params, deps.qldPublic ?? false);
  if (route === 'status') {
    const now = deps.now();
    const [served, run, calls, qld] = await Promise.all([
      deps.getSnapshot().then(
        (loaded) => nswPart(loaded),
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
      // A missing count is not a pipeline problem; the rest of the report still is.
      deps.getCalls(sydneyMonth(new Date(now))).catch((error: unknown) => {
        console.error('Reading the call count failed', error);
        return null;
      }),
      deps.getQldStatus?.().catch((error: unknown): QldStatusInput => {
        console.error('Reading the QLD records failed', error);
        return {
          lastRun: null,
          lastRunError: error instanceof Error ? error.message : String(error),
          written: null,
          calls: null,
          reference: null,
        };
      }),
    ]);
    const report = statusReport({
      served,
      ...run,
      calls,
      ...(qld ? { qld } : {}),
      qldPublic: deps.qldPublic ?? false,
      now,
    });
    return json(report, report.healthy ? 200 : 503, 'no-store');
  }

  // Validate before touching the snapshot: bad input is a 400 even when the
  // snapshot is missing.
  if (route === 'stations') {
    const codes = parseStationCodes(params);
    const { snapshot } = await deps.getSnapshot();
    const stale = deps.now() - Date.parse(snapshot.fetchedAt) > STALE_AFTER_MS;
    return cached(stationsBody(snapshot, codes, stale), CACHE, 'stations');
  }
  if (route === 'history') {
    const code = parseStationCode(params);
    const fuel = parseFuelType(params);
    // The snapshot first: a made-up code is a 404 that costs no Blobs reads.
    const { snapshot } = await deps.getSnapshot();
    assertListed(snapshot, code);
    const files = await deps.getHistory(code);
    return cached(historyBody(snapshot, code, fuel, files), HISTORY_CACHE, 'history');
  }
  if (route === 'nearby') {
    const query = parseNearbyQuery(params, deps.qldPublic ?? false);
    const loaded = await deps.getSnapshot();
    const yesterday = await yesterdayFor(loaded, query.fuelType, deps);
    const origin = { latitude: query.latitude, longitude: query.longitude };
    const { stations: all } = loaded.snapshot;
    const stations = searchNearby(all, origin, query.radiusKm, query.fuelType, yesterday);
    const where = { ...origin, label: null };
    return respond('nearby', loaded, deps.now(), query.fuelType, where, stations, yesterday);
  }

  const query = parseLocationQuery(params, deps.qldPublic ?? false);
  const loaded = await deps.getSnapshot();
  const place = resolvePlace(loaded.places, query, deps.qldPublic ?? false);
  const yesterday = await yesterdayFor(loaded, query.fuelType, deps);
  const { stations: all } = loaded.snapshot;
  const stations = searchPlace(all, place, query.radiusKm, query.fuelType, yesterday);
  const origin = { latitude: place.latitude, longitude: place.longitude, label: place.label };
  return respond('location', loaded, deps.now(), query.fuelType, origin, stations, yesterday);
}

/**
 * One fuel's prices on the day before each source's snapshot, for "since
 * yesterday": NSW's Sydney day from its own files, Queensland's Brisbane day
 * from its own. Codes cannot collide, so one map holds both.
 */
async function yesterdayFor(
  { snapshot, sources }: LoadedSnapshot,
  fuel: FuelTypeCode,
  deps: HandlerDeps,
): Promise<YesterdayPrices | undefined> {
  const nswAt = sources?.find((s) => s.id === 'nsw')?.fetchedAt;
  const qldAt = sources?.find((s) => s.id === 'qld')?.fetchedAt;
  const [nsw, qld] = await Promise.all([
    nswAt || !sources
      ? deps.getDay(addDays(sydneyDay(new Date(nswAt ?? snapshot.fetchedAt)), -1))
      : null,
    qldAt && deps.getQldDay ? deps.getQldDay(addDays(brisbaneDay(new Date(qldAt)), -1)) : null,
  ]);
  const nswFuel = nsw?.[fuel];
  const qldFuel = qld?.[fuel];
  if (!qldFuel) return nswFuel;
  return { ...nswFuel, ...qldFuel };
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
