import { ApiError } from './http';
import { COORDINATE_DECIMALS } from '../../../shared/api';
import { FUEL_TYPE_CODES, isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';
import { roundTo } from '../../lib/geo';
import { QLD_BOUNDS } from '../../lib/qld/mapping';

/**
 * A rough box around NSW and the ACT, a little generous at the borders. Every
 * station in the live data is inside it. Its only job is to refuse obviously
 * wrong input (swapped lat/lng, 0,0, another state) with a clear message,
 * rather than an empty list.
 */
export const NSW_BOUNDS = { minLat: -37.6, maxLat: -28.1, minLng: 140.9, maxLng: 153.7 };

/**
 * The same for Queensland (round 15, lib/qld/mapping.ts), used only while it
 * is served. Two boxes rather than one big one, so "outside" still means
 * Victoria or the NT.
 */
export { QLD_BOUNDS };

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
const inside = (b: Bounds, lat: number, lng: number) =>
  lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

/** What the API covers, in words, for its messages. */
export const coverage = (withQld: boolean): string =>
  withQld ? 'NSW, the ACT and Queensland' : 'NSW and the ACT';

export const RADIUS_KM = { min: 1, max: 25, default: 5 };

export interface NearbyQuery {
  latitude: number;
  longitude: number;
  radiusKm: number;
  fuelType: FuelTypeCode;
}

export type LocationQuery = (
  | { kind: 'postcode'; postcode: string }
  | {
      kind: 'suburb';
      /** The name, with any ABS qualifier: "Kingswood (Penrith)". */
      suburb: string;
      state: 'NSW' | 'ACT' | 'QLD' | null;
      postcode: string | null;
      /** The whole query, tidied, for matching a suggestion label exactly. */
      text: string;
    }
) & { radiusKm: number; fuelType: FuelTypeCode };

function required(params: URLSearchParams, name: string): string {
  const value = params.get(name)?.trim();
  if (!value) throw new ApiError('bad_request', `Missing required parameter "${name}".`);
  return value;
}

function parseNumber(params: URLSearchParams, name: string): number {
  const raw = required(params, name);
  // Number() rather than parseFloat: "151abc" must be an error, not 151.
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ApiError('bad_request', `Parameter "${name}" must be a number.`);
  }
  return value;
}

export function parseFuelType(params: URLSearchParams): FuelTypeCode {
  // Case-insensitive: "e10" from a hand-typed URL means E10.
  const value = required(params, 'fuel').toUpperCase();
  if (!isFuelTypeCode(value)) {
    throw new ApiError(
      'bad_request',
      `Unknown fuel type "${value}". Expected one of: ${FUEL_TYPE_CODES.join(', ')}.`,
    );
  }
  return value;
}

/** Optional, and clamped rather than refused: 100 km is served as the largest search we allow. */
function parseRadius(params: URLSearchParams): number {
  if (!params.get('radius')?.trim()) return RADIUS_KM.default;
  const raw = parseNumber(params, 'radius');
  return Math.min(RADIUS_KM.max, Math.max(RADIUS_KM.min, Math.round(raw)));
}

export function parseNearbyQuery(params: URLSearchParams, withQld = false): NearbyQuery {
  const latitude = parseNumber(params, 'lat');
  const longitude = parseNumber(params, 'lng');

  // Refused, not clamped: clamping would quietly search somewhere the user is not.
  const covered =
    inside(NSW_BOUNDS, latitude, longitude) || (withQld && inside(QLD_BOUNDS, latitude, longitude));
  if (!covered) {
    throw new ApiError(
      'bad_request',
      withQld
        ? `That location is outside the area we cover. Fuel Finder covers ${coverage(true)}.`
        : 'That location is outside NSW.',
    );
  }

  return {
    latitude: roundTo(latitude, COORDINATE_DECIMALS),
    longitude: roundTo(longitude, COORDINATE_DECIMALS),
    radiusKm: parseRadius(params),
    fuelType: parseFuelType(params),
  };
}

/*
 * A suburb is letters (any script), spaces, hyphens, apostrophes and full
 * stops: "Woy Woy", "O'Connell", "St. Ives". It may carry the ABS qualifier
 * that tells repeated names apart, "Kingswood (Penrith)", and be followed by
 * a state and/or postcode - which is exactly the shape of a suggestion label,
 * "Kingswood (Penrith) NSW 2747". A postcode alone is four digits; NSW and ACT
 * ones start with 1 or 2, Queensland's (round 15, only while it is public)
 * with 4.
 */
const POSTCODE = /^[12]\d{3}$/;
const SUBURB =
  /^(\p{L}[\p{L} .'-]{1,59}?(?:\s*\([\p{L} .'-]{1,40}\))?)(?:\s+(NSW|ACT))?(?:\s+([12]\d{3}))?$/iu;
const POSTCODE_WITH_QLD = /^[124]\d{3}$/;
const SUBURB_WITH_QLD =
  /^(\p{L}[\p{L} .'-]{1,59}?(?:\s*\([\p{L} .'-]{1,40}\))?)(?:\s+(NSW|ACT|QLD))?(?:\s+([124]\d{3}))?$/iu;

export function parseLocationQuery(params: URLSearchParams, withQld = false): LocationQuery {
  const query = required(params, 'query')
    // Phones autocorrect ' to a curly quote.
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
  const common = { radiusKm: parseRadius(params), fuelType: parseFuelType(params) };

  if ((withQld ? POSTCODE_WITH_QLD : POSTCODE).test(query)) {
    return { kind: 'postcode', postcode: query, ...common };
  }

  const match = (withQld ? SUBURB_WITH_QLD : SUBURB).exec(query);
  const suburb = match?.[1]?.trim();
  if (!match || !suburb) {
    throw new ApiError(
      'bad_request',
      withQld
        ? `Enter a suburb name or a four-digit postcode. Fuel Finder covers ${coverage(true)}.`
        : 'Enter a NSW suburb name or a four-digit postcode.',
    );
  }
  const state = match[2]?.toUpperCase();
  return {
    kind: 'suburb',
    suburb,
    state: state === 'NSW' || state === 'ACT' || state === 'QLD' ? state : null,
    postcode: match[3] ?? null,
    text: query,
    ...common,
  };
}
