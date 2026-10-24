import { ApiRequestError } from '@/lib/api';
import { formatPrice } from '@/lib/format';

import type { PricesResponse, StationPrice } from '../../../shared/api';
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
  | { kind: 'empty'; data: PricesResponse }
  | { kind: 'results'; data: PricesResponse; stations: StationPrice[] };

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
  stations: StationPrice[];
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
  if (input.stations.length === 0) return { kind: 'empty', data: input.data };
  return { kind: 'results', data: input.data, stations: input.stations };
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
  { refreshedAsOf }: { refreshedAsOf?: string | undefined } = {},
): string {
  switch (view.kind) {
    case 'locating':
      return 'Finding your location…';
    case 'loading':
      return 'Loading prices…';
    case 'empty':
      return `No stations found selling ${fuelName}.`;
    case 'results': {
      const [cheapest] = view.stations;
      const count = view.stations.length;
      const refreshed = refreshedAsOf ? `Prices updated, as of ${refreshedAsOf}. ` : '';
      const listed =
        count > LIST_PAGE_SIZE ? ` Listing the cheapest ${String(LIST_PAGE_SIZE)}.` : '';
      const summary = `${refreshed}${String(count)} ${count === 1 ? 'station' : 'stations'} found.${listed}`;
      const best = cheapest
        ? ` Cheapest ${fuelName} is ${formatPrice(cheapest.priceCents)} cents a litre at ${cheapest.name}.`
        : '';
      return `${summary}${best}${view.data.stale ? ' These prices may be out of date.' : ''}`;
    }
    case 'error':
      return view.error.code === 'ambiguous_location' ? whichPlace(view.error) : '';
    case 'idle':
    case 'location-problem':
      return '';
  }
}
