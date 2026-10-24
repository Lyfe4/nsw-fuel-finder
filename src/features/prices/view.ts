import { ApiRequestError } from '@/lib/api';
import { formatDistance, formatPrice } from '@/lib/format';

import type { PricesResponse, StationPrice } from '../../../shared/api';
import type { ResultsSort } from '../search/searchState';
import type { GeolocationStatus } from '../search/useGeolocation';

export type LocationProblem = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/**
 * How many stations the list shows at first, and how many more each "Show
 * more" adds. Twenty is a screenful or two on a phone and more than most
 * people compare; see StationList for why it is not all of them.
 */
export const LIST_PAGE_SIZE = 20;

/** Everything the results area can be showing, one at a time. */
export type ResultsView =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'location-problem'; problem: LocationProblem }
  | { kind: 'loading' }
  | { kind: 'error'; error: ApiRequestError }
  /** Nothing within the distance, and nothing nearer than NEAREST_MAX_KM either. */
  | { kind: 'empty'; data: PricesResponse }
  /** Nothing within the distance: the nearest stations instead, nearest first. */
  | { kind: 'nearest'; data: PricesResponse; stations: StationPrice[] }
  /** Stations within the distance, but the filters leave out every one. */
  | { kind: 'no-match'; data: PricesResponse; total: number }
  | {
      kind: 'results';
      data: PricesResponse;
      /** What is shown: filtered and sorted. */
      stations: StationPrice[];
      /** How many the search found, before filters. */
      total: number;
      filtered: boolean;
    };

const LOCATION_PROBLEMS = new Set<GeolocationStatus>([
  'denied',
  'unavailable',
  'timeout',
  'unsupported',
]);

function isLocationProblem(status: GeolocationStatus): status is LocationProblem {
  return LOCATION_PROBLEMS.has(status);
}

/**
 * Decides what the results area shows. Order matters: a location request in
 * flight or just failed is the newest thing the user did, so it outranks
 * whatever the last search returned.
 */
export function resultsView(input: {
  geolocation: GeolocationStatus;
  hasSearch: boolean;
  pending: boolean;
  error: unknown;
  data: PricesResponse | undefined;
  /** Every station the search found, before filters. */
  stations: StationPrice[];
  /** After filters, in the chosen order. */
  shown: StationPrice[];
  filtered: boolean;
  /** The nearest stations, for a search that found none. */
  nearest: StationPrice[];
}): ResultsView {
  if (input.geolocation === 'locating') return { kind: 'locating' };
  if (isLocationProblem(input.geolocation)) {
    return { kind: 'location-problem', problem: input.geolocation };
  }
  if (!input.hasSearch) return { kind: 'idle' };
  // A failed background refresh keeps showing what we have; only a search
  // with nothing to show is an error.
  if (input.error && !input.data) {
    const error =
      input.error instanceof ApiRequestError
        ? input.error
        : new ApiRequestError(0, 'unexpected', 'Something went wrong.');
    return { kind: 'error', error };
  }
  if (input.pending || !input.data) return { kind: 'loading' };
  if (input.stations.length === 0) {
    return input.nearest.length > 0
      ? { kind: 'nearest', data: input.data, stations: input.nearest }
      : { kind: 'empty', data: input.data };
  }
  const total = input.stations.length;
  if (input.shown.length === 0) return { kind: 'no-match', data: input.data, total };
  return {
    kind: 'results',
    data: input.data,
    stations: input.shown,
    total,
    filtered: input.filtered,
  };
}

/** The question asked when a place name means more than one place. */
export function whichPlace(error: ApiRequestError): string {
  return `${error.message} Which did you mean?`;
}

/**
 * What the polite status region says. Errors are not here: they are shown in
 * a role="alert" block, which announces itself, and saying them twice would
 * be noise. "Which place did you mean?" is not an error, so it is said here.
 *
 * `refreshedAsOf` is set when the same search has just been answered from a
 * newer snapshot, which happens without a word when someone comes back to the
 * tab. The prices on screen have changed under them, so they are told.
 */
export function announcement(
  view: ResultsView,
  fuelName: string,
  {
    refreshedAsOf,
    radius,
    sort = 'price',
  }: { refreshedAsOf?: string | undefined; radius?: number; sort?: ResultsSort } = {},
): string {
  switch (view.kind) {
    case 'locating':
      return 'Finding your location…';
    case 'loading':
      return 'Loading prices…';
    case 'empty':
      return `No stations found selling ${fuelName}.`;
    case 'results': {
      const cheapest = cheapestOf(view.stations);
      const count = view.stations.length;
      const refreshed = refreshedAsOf ? `Prices updated, as of ${refreshedAsOf}. ` : '';
      const order = sort === 'distance' ? 'nearest' : 'cheapest';
      const listed =
        count > LIST_PAGE_SIZE ? ` Listing the ${order} ${String(LIST_PAGE_SIZE)}.` : '';
      const found = view.filtered
        ? `${String(count)} of ${String(view.total)} stations match your filters.`
        : `${String(count)} ${count === 1 ? 'station' : 'stations'} found.`;
      const best = cheapest
        ? ` Cheapest ${fuelName} is ${formatPrice(cheapest.priceCents)} cents a litre at ${cheapest.name}.`
        : '';
      return `${refreshed}${found}${listed}${best}${view.data.stale ? ' These prices may be out of date.' : ''}`;
    }
    case 'nearest': {
      const cheapest = cheapestOf(view.stations);
      const none =
        radius === undefined ? 'No stations nearby.' : `None within ${String(radius)} km.`;
      const best = cheapest
        ? ` Cheapest of them is ${formatPrice(cheapest.priceCents)} cents a litre at ${cheapest.name}.`
        : '';
      return `${none} The nearest ${String(view.stations.length)} selling ${fuelName} are ${distanceRange(view.stations, ' to ')} away.${best}`;
    }
    case 'no-match':
      return `None of the ${String(view.total)} stations match your filters.`;
    case 'error':
      return view.error.code === 'ambiguous_location' ? whichPlace(view.error) : '';
    case 'idle':
    case 'location-problem':
      return '';
  }
}

/** The cheapest station, whatever order the list is in. */
function cheapestOf(stations: readonly StationPrice[]): StationPrice | undefined {
  return stations.reduce<StationPrice | undefined>(
    (best, station) => (!best || station.priceCents < best.priceCents ? station : best),
    undefined,
  );
}

/** "38–72 km" (or with ` to ` for speech): the nearest and furthest of a list. */
export function distanceRange(stations: readonly StationPrice[], dash = '–'): string {
  const km = stations.map((station) => station.distanceKm);
  const near = formatDistance(Math.min(...km));
  const far = formatDistance(Math.max(...km));
  if (near === far) return near;
  // "38 km–72 km" reads better as "38–72 km" when both are in km.
  const [nearValue, nearUnit] = near.split(' ');
  const [farValue, farUnit] = far.split(' ');
  return nearUnit === farUnit
    ? `${nearValue ?? ''}${dash}${farValue ?? ''} ${farUnit ?? ''}`
    : `${near}${dash}${far}`;
}
