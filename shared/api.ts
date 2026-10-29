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
  /**
   * Cents a litre since the station's last price yesterday (Sydney time):
   * -2 is two cents cheaper. 0 when unchanged; null when we have no price for
   * it yesterday (a new station, or yesterday's history could not be read).
   */
  changeCents: number | null;
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
  /**
   * Only when `stations` is empty: the NEAREST_COUNT nearest stations selling
   * this fuel, at any distance up to NEAREST_MAX_KM, nearest first. A field
   * of its own, so a page still running older code ignores it and shows its
   * empty state, rather than listing stations 60 km away as "within 5 km".
   */
  nearest: StationPrice[];
}

/** How many stations `nearest` lists, and how far it looks. */
export const NEAREST_COUNT = 10;
export const NEAREST_MAX_KM = 100;

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

/**
 * GET /api/status: whether the price pipeline is healthy end to end. 200 when
 * healthy, 503 with `problems` when not; never cached.
 */
export interface StatusResponse {
  healthy: boolean;
  /** Plain-English reasons it is not healthy; empty when it is. */
  problems: string[];
  checkedAt: string;
  /**
   * API.NSW calls the scheduled job has made this Sydney month, by its own
   * count, against what the schedule is planned to need. The quota is 2,500.
   */
  callsThisMonth: { month: string; calls: number; budget: number };
  /** The snapshot this API instance is serving. */
  served: { fetchedAt: string; stations: number } | null;
  /** The latest scheduled run, as recorded in Blobs. */
  lastRun: { ok: boolean; startedAt: string; fetchedAt?: string; error?: string } | null;
  /**
   * Round 15: each source on its own. The fields above are NSW's, kept as
   * they were. Queensland's problems count towards `healthy` and `problems`
   * only once it is public.
   */
  sources: { qld: QldSourceStatus };
}

/** Queensland's pipeline in /api/status. */
export interface QldSourceStatus {
  healthy: boolean;
  /** Whether the API serves Queensland's prices (QLD_PUBLIC). */
  public: boolean;
  /** Plain-English reasons, without the "QLD: " the top-level list adds. */
  problems: string[];
  lastRun: { ok: boolean; startedAt: string; fetchedAt?: string; error?: string } | null;
  /** The newest snapshot the QLD job wrote. */
  written: { fetchedAt: string; stations: number } | null;
  /** When the site details (names, brands, addresses) were last fetched. */
  referenceFetchedAt: string | null;
  /** Calls this Brisbane month, against the level that raises an alarm. */
  callsThisMonth: { month: string; calls: number; budget: number };
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

/** A station and every fuel it sells now, for favourites and the history view. */
export interface StationSummary {
  stationCode: string;
  name: string;
  brand: string;
  address: string;
  latitude: number;
  longitude: number;
  /** By fuel code; a fuel the station does not sell is absent. */
  prices: Partial<Record<string, { priceCents: number; updatedAt: string }>>;
}

/** GET /api/stations?codes=1,2,3 */
export interface StationsResponse {
  fetchedAt: string;
  stale: boolean;
  /** In the order asked for. */
  stations: StationSummary[];
  /** Asked for but not in the snapshot: closed, renumbered, or never real. */
  missing: string[];
}

/** One day of one fuel at one station: cents a litre, low, high and the day's last. */
export type HistoryDayRow = [day: string, low: number, high: number, last: number];

/** Where a stretch of history came from, for the credit shown beside it. */
export interface HistorySource {
  kind: 'fuelcheck-monthly' | 'snapshots';
  /** First and last day this source covers for this station and fuel. */
  from: string;
  through: string;
}

/** GET /api/history?station=972&fuel=U91 */
export interface HistoryResponse {
  fuelType: string;
  station: StationSummary;
  /** Oldest first. Days with no data have no row. */
  days: HistoryDayRow[];
  sources: HistorySource[];
  /** Licence of the history data, which is adapted from CC BY-SA open data. */
  licence: string;
}

/** Most favourites /api/stations answers for at once. */
export const MAX_STATION_CODES = 50;
