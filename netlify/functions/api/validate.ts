import { ApiError } from './http';
import { COORDINATE_DECIMALS } from '../../../shared/api';
import { FUEL_TYPE_CODES, isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';
import { roundTo } from '../../lib/geo';

/**
 * A rough box around NSW and the ACT, a little generous at the borders. Every
 * station in the live data is inside it. Its only job is to refuse obviously
 * wrong input (swapped lat/lng, 0,0, another state) with a clear message,
 * rather than an empty list.
 */
export const NSW_BOUNDS = { minLat: -37.6, maxLat: -28.1, minLng: 140.9, maxLng: 153.7 };

export const RADIUS_KM = { min: 1, max: 25, default: 5 };

export interface NearbyQuery {
  latitude: number;
  longitude: number;
  radiusKm: number;
  fuelType: FuelTypeCode;
}

export type LocationQuery = (
  | { kind: 'postcode'; postcode: string }
  | { kind: 'suburb'; suburb: string; postcode: string | null }
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

export function parseNearbyQuery(params: URLSearchParams): NearbyQuery {
  const latitude = parseNumber(params, 'lat');
  const longitude = parseNumber(params, 'lng');
  const { minLat, maxLat, minLng, maxLng } = NSW_BOUNDS;

  // Refused, not clamped: clamping would quietly search somewhere the user is not.
  if (latitude < minLat || latitude > maxLat || longitude < minLng || longitude > maxLng) {
    throw new ApiError('bad_request', 'That location is outside NSW.');
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
 * stops: "Woy Woy", "O'Connell", "St. Ives". It may be followed by a state
 * and/or a postcode, which is how an ambiguous name is narrowed down -
 * "Kingswood NSW 2747" is exactly what `candidates` offers. A postcode alone
 * is four digits; NSW and ACT ones start with 1 or 2.
 */
const POSTCODE = /^[12]\d{3}$/;
const SUBURB = /^(\p{L}[\p{L} .'-]{1,49}?)(?:\s+(?:NSW|ACT))?(?:\s+([12]\d{3}))?$/iu;

export function parseLocationQuery(params: URLSearchParams): LocationQuery {
  const query = required(params, 'query')
    // Phones autocorrect ' to a curly quote.
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
  const common = { radiusKm: parseRadius(params), fuelType: parseFuelType(params) };

  if (POSTCODE.test(query)) return { kind: 'postcode', postcode: query, ...common };

  const match = SUBURB.exec(query);
  const suburb = match?.[1]?.trim();
  if (!match || !suburb) {
    throw new ApiError('bad_request', 'Enter a NSW suburb name or a four-digit postcode.');
  }
  return { kind: 'suburb', suburb, postcode: match[2] ?? null, ...common };
}
