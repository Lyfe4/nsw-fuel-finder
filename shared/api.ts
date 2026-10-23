/**
 * The contract between the browser and our /api/* function.
 *
 * These are OUR types, not API.NSW's. The browser never sees the upstream
 * shape: a scheduled job turns it into a snapshot, and /api/* answers from
 * that snapshot.
 */

export interface StationPrice {
  /** FuelCheck's station code, always a string. */
  stationCode: string;
  name: string;
  brand: string;
  address: string;
  latitude: number;
  longitude: number;
  /**
   * Kilometres from `origin`. For nearby searches the origin is the user's
   * position rounded to ~1 km (see COORDINATE_DECIMALS), so the client should
   * recompute this from the precise position it already has.
   */
  distanceKm: number;
  /** Cents per litre, e.g. 189.9. */
  priceCents: number;
  /** When the station reported this price, ISO 8601 UTC. */
  priceUpdatedAt: string;
}

/** The point distances are measured from. */
export interface SearchOrigin {
  latitude: number;
  longitude: number;
  /** For a suburb or postcode search, the place it resolved to; null for nearby. */
  label: string | null;
}

/** GET /api/nearby and GET /api/location */
export interface PricesResponse {
  fuelType: string;
  /** When the snapshot these prices come from was taken, ISO 8601 UTC. */
  fetchedAt: string;
  /**
   * True when the snapshot is older than it should be (the scheduled refresh
   * has missed several runs). The prices are still the latest we have; the
   * UI should say how old they are.
   */
  stale: boolean;
  origin: SearchOrigin;
  /** Cheapest first; ties broken by distance, then name. */
  stations: StationPrice[];
}

/** GET /api/places?query=... */
export interface PlaceSuggestionsResponse {
  /** The query these are for, so a late response can be told from a current one. */
  query: string;
  /**
   * Up to 8 place labels, best first, e.g. "Kingswood (Penrith) NSW 2747".
   * Each one, sent back as /api/location's `query`, resolves to exactly
   * that place.
   */
  suggestions: string[];
}

export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'method_not_allowed'
  | 'location_not_found'
  | 'ambiguous_location'
  | 'snapshot_unavailable'
  | 'internal_error';

/** Every non-2xx response from /api/* has this body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /**
     * For `ambiguous_location` only: the places the query could mean, each
     * usable as a new `query` value (e.g. "Kingswood 2747").
     */
    candidates?: string[];
  };
}

/**
 * Decimal places kept on a nearby-search coordinate. Two places is ~1.1 km of
 * latitude. Upstream calls no longer depend on it; it is kept so that
 * neighbours share a CDN cache entry and so that the URL - which ends up in
 * history, logs and shared links - never carries anyone's exact position.
 */
export const COORDINATE_DECIMALS = 2;
