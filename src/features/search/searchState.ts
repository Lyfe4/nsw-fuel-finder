import { COORDINATE_DECIMALS } from '../../../shared/api';
import { isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';
import { roundTo } from '../../../shared/geo';

/**
 * The search lives in the page URL, so it can be shared, survives a reload,
 * and Back undoes it. Parameter names are the API's own (`fuel`, `query`,
 * `lat`, `lng`, `radius`), so a page URL and the API call it makes read the
 * same.
 *
 *   /?fuel=U91&query=Erina%20NSW%202250
 *   /?fuel=E10&lat=-33.87&lng=151.21&radius=10
 *   /?fuel=U91&query=2250&view=map&station=2263
 *
 * `view` and `station` are how the results are shown, not what was
 * searched: the map or the list on a phone, and the station picked out on
 * both. They are in the URL so a shared link opens on the same station.
 */

export const DEFAULT_FUEL: FuelTypeCode = 'U91';
export const DEFAULT_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 25;

export type SearchPlace =
  { kind: 'nearby'; lat: number; lng: number } | { kind: 'location'; query: string };

export type ResultsLayout = 'list' | 'map';

export interface SearchState {
  fuel: FuelTypeCode;
  radius: number;
  place: SearchPlace | null;
  /** Which of the two a narrow screen shows. Wide screens show both. */
  view: ResultsLayout;
  /** The selected station's code, whether or not it is in the results. */
  station: string | null;
}

/** Station codes are short numbers today; this is loose enough to outlive that. */
const STATION_CODE = /^[\w-]{1,32}$/;

/** Never throws: a hand-edited or stale URL falls back to sensible defaults. */
export function parseSearch(search: string): SearchState {
  const params = new URLSearchParams(search);

  const fuelParam = params.get('fuel')?.toUpperCase() ?? '';
  const fuel = isFuelTypeCode(fuelParam) ? fuelParam : DEFAULT_FUEL;

  const radiusParam = Number(params.get('radius'));
  const radius =
    Number.isInteger(radiusParam) && radiusParam >= 1 && radiusParam <= MAX_RADIUS_KM
      ? radiusParam
      : DEFAULT_RADIUS_KM;

  const query = params.get('query')?.trim();
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasPosition =
    params.has('lat') && params.has('lng') && Number.isFinite(lat) && Number.isFinite(lng);

  // A typed place wins over a position: it is the more deliberate of the two.
  const place: SearchPlace | null = query
    ? { kind: 'location', query }
    : hasPosition
      ? { kind: 'nearby', ...roundPosition(lat, lng) }
      : null;

  const view: ResultsLayout = params.get('view') === 'map' ? 'map' : 'list';
  const stationParam = params.get('station') ?? '';
  const station = STATION_CODE.test(stationParam) ? stationParam : null;

  return { fuel, radius, place, view, station };
}

export function serializeSearch({ fuel, radius, place, view, station }: SearchState): string {
  const params = new URLSearchParams({ fuel });
  if (place?.kind === 'location') params.set('query', place.query);
  if (place?.kind === 'nearby') {
    params.set('lat', String(place.lat));
    params.set('lng', String(place.lng));
  }
  if (radius !== DEFAULT_RADIUS_KM) params.set('radius', String(radius));
  if (view === 'map') params.set('view', 'map');
  if (station) params.set('station', station);
  return params.toString();
}

/**
 * ~1 km. The page URL ends up in history and shared links and must never
 * carry anyone's exact position; the precise one stays in memory only.
 */
export function roundPosition(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: roundTo(lat, COORDINATE_DECIMALS), lng: roundTo(lng, COORDINATE_DECIMALS) };
}
