import { useCallback, useMemo, useRef } from 'react';

import { refineNearby } from '@/features/prices/refine';
import { Results } from '@/features/prices/Results';
import { usePrices } from '@/features/prices/usePrices';
import { resultsView } from '@/features/prices/view';

import { SearchForm } from './SearchForm';
import { MAX_RADIUS_KM, roundPosition } from './searchState';
import { useGeolocation } from './useGeolocation';
import { useSearchState } from './useSearchState';
import { FUEL_TYPES } from '../../../shared/fuelTypes';

import type { LatLng } from '../../../shared/geo';

/**
 * The one screen: the search form and its results. State lives in three
 * places, each owning its own part: the URL (what was searched), TanStack
 * Query (what the API said), and the geolocation hook (the precise position,
 * which is never written anywhere).
 */
export function SearchScreen() {
  const search = useSearchState();
  const { searchNearby, searchLocation, setFuel, setRadius } = search;
  const placeInput = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  const onLocated = useCallback(
    (position: LatLng) => {
      searchNearby(position.latitude, position.longitude);
    },
    [searchNearby],
  );
  const geolocation = useGeolocation(onLocated);

  const { fuel, radius, place } = search;
  const priceSearch = useMemo(
    () => (place ? { fuel, radius, place } : null),
    [fuel, radius, place],
  );
  const prices = usePrices(priceSearch);

  // With the precise position for this very search, show real distances.
  const stations = useMemo(() => {
    const data = prices.data;
    if (!data) return [];
    const precise = geolocation.position;
    if (place?.kind !== 'nearby' || !precise) return data.stations;
    const rounded = roundPosition(precise.latitude, precise.longitude);
    if (rounded.lat !== place.lat || rounded.lng !== place.lng) return data.stations;
    return refineNearby(data.stations, precise, radius);
  }, [prices.data, geolocation.position, place, radius]);

  const view = resultsView({
    geolocation: geolocation.status,
    hasSearch: place !== null,
    pending: prices.isPending,
    error: prices.error,
    data: prices.data,
    stations,
  });

  const fuelName = FUEL_TYPES.find((f) => f.code === fuel)?.name ?? fuel;

  /*
   * Buttons in the results area (Retry, Widen, a "did you mean" choice)
   * disappear when they work. Focus moves first, in the same click, so a
   * keyboard user is not dropped onto <body>.
   */
  const focusResults = () => resultsHeading.current?.focus();
  const focusSearch = () => placeInput.current?.focus();

  return (
    <>
      <SearchForm
        fuel={fuel}
        currentQuery={place?.kind === 'location' ? place.query : ''}
        locating={geolocation.status === 'locating'}
        onFuelChange={setFuel}
        onSearchPlace={(query) => {
          geolocation.reset();
          searchLocation(query);
        }}
        onUseLocation={geolocation.locate}
        placeInputRef={placeInput}
      />
      <Results
        view={view}
        fuelName={fuelName}
        radius={radius}
        maxRadius={MAX_RADIUS_KM}
        now={new Date()}
        headingRef={resultsHeading}
        onRetry={() => {
          focusResults();
          void prices.refetch();
        }}
        onRetryLocation={() => {
          focusResults();
          geolocation.locate();
        }}
        onPickCandidate={(candidate) => {
          focusSearch();
          geolocation.reset();
          searchLocation(candidate);
        }}
        onWiden={() => {
          focusResults();
          setRadius(MAX_RADIUS_KM);
        }}
        onSearchInstead={() => {
          geolocation.reset();
          focusSearch();
        }}
      />
    </>
  );
}
