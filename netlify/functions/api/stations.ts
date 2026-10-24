import { ApiError } from './http';
import { MAX_STATION_CODES } from '../../../shared/api';
import { FUEL_TYPE_CODES, type FuelTypeCode } from '../../../shared/fuelTypes';
import {
  addDays,
  HISTORY_LICENCE,
  HISTORY_WINDOW_DAYS,
  mergeHistory,
  stationHistorySchema,
} from '../../lib/history/stationHistory';
import { sydneyDay } from '../../lib/upstream/time';

import type { HistoryResponse, StationSummary, StationsResponse } from '../../../shared/api';
import type { Snapshot, SnapshotStation } from '../../lib/snapshot/format';

/*
 * /api/stations and /api/history: stations looked up by code, not by place.
 * Both answer from the snapshot the API already holds in memory (and, for
 * history, two small per-station files), so neither costs an API.NSW call.
 */

/** Station codes are short numbers today; this is loose enough to outlive that. */
const STATION_CODE = /^[\w-]{1,32}$/;

export function toSummary(station: SnapshotStation): StationSummary {
  const prices: StationSummary['prices'] = {};
  for (const fuel of FUEL_TYPE_CODES) {
    const tuple = station.prices[fuel];
    if (tuple) prices[fuel] = { priceCents: tuple[0], updatedAt: tuple[1] };
  }
  return {
    stationCode: station.code,
    name: station.name,
    brand: station.brand,
    address: station.address,
    latitude: station.lat,
    longitude: station.lng,
    prices,
  };
}

/** `codes=972,1043`: unique, valid, and few enough to answer in one go. */
export function parseStationCodes(params: URLSearchParams): string[] {
  const raw = params.get('codes')?.trim() ?? '';
  if (!raw) throw new ApiError('bad_request', 'Missing required parameter "codes".');
  const codes = [...new Set(raw.split(',').map((code) => code.trim()))].filter(Boolean);
  if (codes.length > MAX_STATION_CODES) {
    throw new ApiError('bad_request', `At most ${String(MAX_STATION_CODES)} stations at once.`);
  }
  const invalid = codes.find((code) => !STATION_CODE.test(code));
  if (invalid !== undefined) throw new ApiError('bad_request', 'Not a station code.');
  return codes;
}

export function parseStationCode(params: URLSearchParams): string {
  const code = params.get('station')?.trim() ?? '';
  if (!STATION_CODE.test(code)) {
    throw new ApiError('bad_request', 'Missing or invalid parameter "station".');
  }
  return code;
}

function byCode(snapshot: Snapshot): Map<string, SnapshotStation> {
  return new Map(snapshot.stations.map((station) => [station.code, station]));
}

export function stationsBody(
  snapshot: Snapshot,
  codes: readonly string[],
  stale: boolean,
): StationsResponse {
  const index = byCode(snapshot);
  const stations: StationSummary[] = [];
  const missing: string[] = [];
  for (const code of codes) {
    const station = index.get(code);
    if (station) stations.push(toSummary(station));
    else missing.push(code);
  }
  return { fetchedAt: snapshot.fetchedAt, stale, stations, missing };
}

/**
 * The last HISTORY_WINDOW_DAYS of one fuel at one station: the published
 * history where it reaches, then our own. A station the snapshot no longer
 * lists is a 404: there is nothing current to show beside its past.
 */
export function historyBody(
  snapshot: Snapshot,
  code: string,
  fuel: FuelTypeCode,
  files: { backfill: unknown; live: unknown },
): HistoryResponse {
  const station = byCode(snapshot).get(code);
  if (!station) throw new ApiError('not_found', 'FuelCheck no longer lists that station.');
  const parse = (value: unknown) => {
    const parsed = stationHistorySchema.safeParse(value);
    return parsed.success && parsed.data.code === code ? parsed.data : null;
  };
  const today = sydneyDay(new Date(snapshot.fetchedAt));
  const since = addDays(today, -(HISTORY_WINDOW_DAYS - 1));
  const { days, sources } = mergeHistory(parse(files.backfill), parse(files.live), fuel, since);
  return { fuelType: fuel, station: toSummary(station), days, sources, licence: HISTORY_LICENCE };
}
