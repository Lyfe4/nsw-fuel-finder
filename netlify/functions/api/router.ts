import {
  cached,
  CACHE,
  ERROR_CDN_CACHE,
  HISTORY_CACHE,
  ROUTES,
  STATUS_CACHE,
  SUGGESTION_CACHE,
  VARY,
  type Route,
} from './cache';
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
import { qldPriceNotices, stationSource } from '../../../shared/api';
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
import type { InvocationContext } from '../../lib/snapshot/context';
import type { HistoryDay } from '../../lib/snapshot/history';

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
  /** What the routes search; Queensland's snapshot only when `withQld` (the gate). */
  getSnapshot: (withQld: boolean) => Promise<LoadedSnapshot>;
  /** One station's two history files (published, and our own); each null when absent. */
  getHistory: (code: string) => Promise<{ backfill: unknown; live: unknown }>;
  /** A finished day's prices (history/v1/DAY), or null; never throws. */
  getDay: (day: string) => Promise<HistoryDay['fuels'] | null>;
  /** The same from Queensland's day files (qld/history/v1/DAY, Brisbane days); read only through the gate. */
  getQldDay?: (day: string) => Promise<HistoryDay['fuels'] | null>;
  /** Queensland's run record, newest snapshot, calls and reference metadata, for /api/status. */
  getQldStatus?: () => Promise<QldStatusInput>;
  /** QLD_PUBLIC === 'true' as this deploy was built: the first of the gate's three conditions. */
  qldEnv?: boolean;
  /** The owner's kill switch in Blobs, the third (deps.ts). Never throws; off when unreadable. */
  qldSwitch?: () => Promise<boolean>;
  now: () => number;
}

/** Each source's own snapshot is stale after three of its own missed runs. */
const STALE_AFTER: Record<SourceId, number> = { nsw: STALE_AFTER_MS, qld: QLD_STALE_AFTER_MS };

/** The sources with a station in an answer, each with its own time and staleness. */
function shownSources(loaded: LoadedSnapshot, codes: readonly string[], now: number) {
  const shown = new Set(codes.map((code) => stationSource(code)));
  const all = loaded.sources ?? [{ id: 'nsw' as const, fetchedAt: loaded.snapshot.fetchedAt }];
  return all
    .filter((source) => shown.has(source.id))
    .map((source): PriceSource => ({
      ...source,
      stale: now - Date.parse(source.fetchedAt) > STALE_AFTER[source.id],
    }));
}

/**
 * Licence notices for an answer (round 16): Queensland's, word for word,
 * when a Queensland station is in it, in the year of its snapshot.
 */
function noticesFor(sources: readonly PriceSource[]): { notices?: string[] } {
  const qld = sources.find((source) => source.id === 'qld');
  if (!qld) return {};
  return { notices: qldPriceNotices(Number(brisbaneDay(new Date(qld.fetchedAt)).slice(0, 4))) };
}

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
  const sources = shownSources(
    loaded,
    [...stations, ...nearest].map((s) => s.stationCode),
    now,
  );
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
    ...noticesFor(sources),
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
 * snapshot's time is the older of the two, which is not when NSW's was
 * taken. Null when NSW could not be read (round 16): Queensland alone is
 * not a snapshot NSW's checks can pass on.
 */
function nswPart(loaded: LoadedSnapshot): Snapshot | null {
  const nsw = loaded.sources?.find((source) => source.id === 'nsw');
  if (loaded.sources && !nsw) return null;
  if (!loaded.sources || loaded.sources.length === 1) return loaded.snapshot;
  return {
    ...loaded.snapshot,
    fetchedAt: nsw?.fetchedAt ?? loaded.snapshot.fetchedAt,
    stations: loaded.snapshot.stations.filter((s) => stationSource(s.code) === 'nsw'),
  };
}

async function dispatch(
  route: Route,
  params: URLSearchParams,
  deps: HandlerDeps,
  qld: boolean,
  context: InvocationContext | undefined,
) {
  if (route === 'places') return suggestions(params, qld);
  if (route === 'status') {
    const now = deps.now();
    const [served, run, calls, qldRecords] = await Promise.all([
      deps.getSnapshot(qld).then(
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
      ...(qldRecords ? { qld: qldRecords } : {}),
      qldPublic: qld,
      now,
    });
    const deploy = {
      context: context?.deploy?.context ?? null,
      published: context?.deploy?.published ?? null,
    };
    const response = json({ ...report, deploy }, report.healthy ? 200 : 503, STATUS_CACHE.browser);
    response.headers.set('Netlify-CDN-Cache-Control', STATUS_CACHE.cdn);
    response.headers.set('Netlify-Vary', VARY.status);
    return response;
  }

  // Validate before touching the snapshot: bad input is a 400 even when the
  // snapshot is missing.
  if (route === 'stations') {
    const codes = parseStationCodes(params);
    const loaded = await deps.getSnapshot(qld);
    const body = stationsBody(loaded.snapshot, codes, false);
    // Each source's own staleness, as in a search (round 16).
    const sources = shownSources(
      loaded,
      body.stations.map((s) => s.stationCode),
      deps.now(),
    );
    const unavailable = [...(loaded.unavailable ?? [])];
    return cached(
      {
        ...body,
        stale: sources.some((source) => source.stale),
        ...(unavailable.length > 0 ? { unavailable } : {}),
        ...noticesFor(sources),
      },
      CACHE,
      'stations',
    );
  }
  if (route === 'history') {
    const code = parseStationCode(params);
    const fuel = parseFuelType(params);
    // The snapshot first: a made-up code is a 404 that costs no Blobs reads.
    const loaded = await deps.getSnapshot(qld);
    const source = stationSource(code);
    // Its source served but too old to show (round 16): unavailable, not gone.
    if (loaded.unavailable?.includes(source)) {
      throw new SnapshotUnavailableError(`The ${source.toUpperCase()} snapshot is unavailable.`);
    }
    assertListed(loaded.snapshot, code);
    const files = await deps.getHistory(code);
    // "Today" is the station's own source's: a merged snapshot's time is the older one.
    const at = loaded.sources?.find((s) => s.id === source)?.fetchedAt ?? loaded.snapshot.fetchedAt;
    const body = historyBody({ ...loaded.snapshot, fetchedAt: at }, code, fuel, files);
    // Queensland's for a minute, as its prices are, so switching it off is quick everywhere.
    return cached(body, source === 'qld' ? CACHE : HISTORY_CACHE, 'history');
  }
  if (route === 'nearby') {
    const query = parseNearbyQuery(params, qld);
    const loaded = await deps.getSnapshot(qld);
    const yesterday = await yesterdayFor(loaded, query.fuelType, deps);
    const origin = { latitude: query.latitude, longitude: query.longitude };
    const { stations: all } = loaded.snapshot;
    const stations = searchNearby(all, origin, query.radiusKm, query.fuelType, yesterday);
    const where = { ...origin, label: null };
    return respond('nearby', loaded, deps.now(), query.fuelType, where, stations, yesterday);
  }

  const query = parseLocationQuery(params, qld);
  const loaded = await deps.getSnapshot(qld);
  const place = resolvePlace(loaded.places, query, qld);
  const yesterday = await yesterdayFor(loaded, query.fuelType, deps);
  const { stations: all } = loaded.snapshot;
  const stations = searchPlace(all, place, query.radiusKm, query.fuelType, yesterday);
  const origin = { latitude: place.latitude, longitude: place.longitude, label: place.label };
  return respond('location', loaded, deps.now(), query.fuelType, origin, stations, yesterday);
}

/**
 * One fuel's prices on the day before each source's snapshot, for "since
 * yesterday": NSW's Sydney day from its own files, Queensland's Brisbane day
 * from its own. Codes cannot collide, so one map holds both. Queensland's
 * day is read only when its snapshot is in the answer, which only the gate
 * allows.
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

/**
 * THE QUEENSLAND GATE, per request: QLD_PUBLIC, the published production
 * deploy, and the owner's kill switch, all three (deps.ts says why each).
 * The switch is read only when the first two hold, so no other deploy, and
 * no deploy built with QLD_PUBLIC off, reads it.
 */
async function qldFor(deps: HandlerDeps, context: InvocationContext | undefined) {
  if (!deps.qldEnv || context?.deploy?.published !== true) return false;
  return (await deps.qldSwitch?.()) ?? false;
}

export function createHandler(
  deps: HandlerDeps,
): (request: Request, context?: InvocationContext) => Promise<Response> {
  return async (request, context) => {
    let route: Route | null = null;
    try {
      const url = new URL(request.url);
      route = matchRoute(url.pathname);
      if (!route) throw new ApiError('not_found', 'No such endpoint.');
      if (request.method !== 'GET') {
        throw new ApiError('method_not_allowed', 'Only GET is supported.');
      }
      return await dispatch(route, url.searchParams, deps, await qldFor(deps, context), context);
    } catch (error) {
      if (error instanceof ApiError) {
        const response = errorResponse(error);
        // A GET's 4xx waits a minute at the edge (round 16), keyed as its route's answers are.
        if (error.status < 500 && request.method === 'GET') {
          response.headers.set('Netlify-CDN-Cache-Control', ERROR_CDN_CACHE);
          if (route) response.headers.set('Netlify-Vary', VARY[route]);
        }
        return response;
      }
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
