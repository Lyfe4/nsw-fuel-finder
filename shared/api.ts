/**
 * The contract between the browser and our /api/* function.
 *
 * These are OUR types, not API.NSW's. The function translates the upstream
 * shape into these, so a change upstream is absorbed in one place
 * (netlify/functions/api/normalise.ts) and the frontend never sees it.
 */

export interface FuelType {
  /** Upstream code, e.g. "E10", "U91", "DL". */
  code: string;
  /** Display name, e.g. "Ethanol 94". */
  name: string;
}

/** GET /api/reference */
export interface ReferenceResponse {
  fuelTypes: FuelType[];
  /** Brand names, sorted. */
  brands: string[];
}

export interface StationPrice {
  /** Upstream station code, always a string here (upstream mixes types). */
  stationCode: string;
  name: string;
  brand: string;
  address: string;
  latitude: number;
  longitude: number;
  /**
   * Kilometres from the search point, as reported upstream. For nearby
   * searches the search point is the user's position rounded to ~1 km (see
   * COORDINATE_DECIMALS), so the client should recompute it from the precise
   * position. Null for suburb/postcode searches, which have no real origin.
   */
  distanceKm: number | null;
  /** Cents per litre, e.g. 189.9. */
  priceCents: number;
  /** When the station reported this price, ISO 8601 with offset. */
  priceUpdatedAt: string;
}

/** GET /api/nearby and GET /api/location */
export interface PricesResponse {
  fuelType: string;
  /** Cheapest first; ties broken by distance, then name. */
  stations: StationPrice[];
}

export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'method_not_allowed'
  | 'not_configured'
  | 'upstream_auth'
  | 'upstream_error'
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'upstream_timeout'
  | 'internal_error';

/** Every non-2xx response from /api/* has this body. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/**
 * Decimal places kept on a nearby-search coordinate. Two places is ~1.1 km of
 * latitude: precise enough to find stations within a few km, coarse enough
 * that neighbours share a CDN cache entry (the free API plan is 2,500 calls a
 * month) and that we never forward anyone's exact position upstream.
 */
export const COORDINATE_DECIMALS = 2;
