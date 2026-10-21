import { ApiError } from './http';
import { COORDINATE_DECIMALS } from '../../../shared/api';
import { FUEL_TYPE_CODES, isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';

/**
 * A rough box around NSW, a little generous at the borders so towns like
 * Albury, Tweed Heads and Broken Hill are inside it. Lord Howe Island is left
 * out: FuelCheck lists no stations there. Not a precise boundary - its only
 * job is to refuse obviously wrong input (swapped lat/lng, 0,0, another
 * state) before it costs an upstream call.
 */
export const NSW_BOUNDS = { minLat: -37.6, maxLat: -28.1, minLng: 140.9, maxLng: 153.7 };

export const RADIUS_KM = { min: 1, max: 25, default: 5 };

export interface NearbyQuery {
  latitude: number;
  longitude: number;
  radiusKm: number;
  fuelType: FuelTypeCode;
}

export interface LocationQuery {
  /** A suburb name or a four-digit postcode. */
  location: string;
  fuelType: FuelTypeCode;
}

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

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

export function parseNearbyQuery(params: URLSearchParams): NearbyQuery {
  const latitude = parseNumber(params, 'lat');
  const longitude = parseNumber(params, 'lng');
  const { minLat, maxLat, minLng, maxLng } = NSW_BOUNDS;

  // Out-of-area coordinates are refused, not clamped: clamping would quietly
  // search somewhere the user is not.
  if (latitude < minLat || latitude > maxLat || longitude < minLng || longitude > maxLng) {
    throw new ApiError('bad_request', 'That location is outside NSW.');
  }

  // Radius is optional and clamped, not refused: asking for 100 km is a
  // reasonable request that we serve as the largest search we allow.
  let radiusKm = RADIUS_KM.default;
  if (params.get('radius')?.trim()) {
    const raw = parseNumber(params, 'radius');
    radiusKm = Math.min(RADIUS_KM.max, Math.max(RADIUS_KM.min, Math.round(raw)));
  }

  return {
    latitude: round(latitude, COORDINATE_DECIMALS),
    longitude: round(longitude, COORDINATE_DECIMALS),
    radiusKm,
    fuelType: parseFuelType(params),
  };
}

/*
 * A suburb is letters (any script - a user may type with accents), spaces,
 * hyphens, apostrophes and full stops: "Woy Woy", "O'Connell", "St. Ives",
 * "Kurri Kurri". A postcode is four digits; NSW's start with 1 or 2.
 */
const SUBURB = /^[\p{L}][\p{L} .'-]{1,49}$/u;
const POSTCODE = /^[12]\d{3}$/;

export function parseLocationQuery(params: URLSearchParams): LocationQuery {
  const location = required(params, 'query')
    // Phones autocorrect ' to a curly quote; upstream only knows the plain one.
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');

  if (!POSTCODE.test(location) && !SUBURB.test(location)) {
    throw new ApiError('bad_request', 'Enter a NSW suburb name or a four-digit postcode.');
  }

  return { location, fuelType: parseFuelType(params) };
}
