import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { FavouritesPanel } from '@/features/favourites/FavouritesPanel';
import { HistoryLinkContext, HistoryLinkHint } from '@/features/history/HistoryLink';
import { LazyHistoryView } from '@/features/history/LazyHistoryView';
import { refineNearby } from '@/features/prices/refine';
import { Results } from '@/features/prices/Results';
import { usePrices } from '@/features/prices/usePrices';
import { useRefreshed } from '@/features/prices/useRefreshed';
import { resultsView } from '@/features/prices/view';

import { SearchForm } from './SearchForm';
import styles from './SearchScreen.module.css';
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
 *
 * A station's price history opens over the results (`history=` in the URL).
 * The favourites and results stay mounted underneath, hidden, so closing it
 * returns to the same list, scrolled where it was, and the same map.
 */
export function SearchScreen() {
  const search = useSearchState();
  const { searchNearby, searchLocation, setFuel, setRadius, setView, selectStation } = search;
  const { openHistory, closeHistory, historyHref } = search;
  const placeInput = useRef<HTMLInputElement>(null);
  const radiusSelect = useRef<HTMLSelectElement>(null);
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
  const searchKey = JSON.stringify(priceSearch);
  const refreshed = useRefreshed(searchKey, prices.data?.fetchedAt);

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

  /*
   * Closing a station's history (its button, or Back) hides the view that had
   * focus. Focus returns to the link that opened it, or to the results
   * heading when that link is not on screen (a shared link, say).
   */
  const lastHistory = useRef(search.history);
  useLayoutEffect(() => {
    const closed = lastHistory.current;
    lastHistory.current = search.history;
    if (closed === null || search.history !== null) return;
    const links = document.querySelectorAll<HTMLElement>(`[data-history-link="${closed}"]`);
    // Not one in a hidden view, or in the closed favourites panel, which
    // links to the same station but cannot take focus while closed.
    const visible = [...links].find((link) => !link.closest('[hidden], details:not([open])'));
    (visible ?? resultsHeading.current)?.focus();
  });

  const now = new Date();
  const historyLinks = useMemo(
    () => ({ href: historyHref, open: openHistory }),
    [historyHref, openHistory],
  );

  return (
    <HistoryLinkContext value={historyLinks}>
      <HistoryLinkHint />
      <SearchForm
        fuel={fuel}
        radius={radius}
        onRadiusChange={setRadius}
        radiusSelectRef={radiusSelect}
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
      {search.history !== null && (
        <LazyHistoryView
          code={search.history}
          fuel={fuel}
          fuelName={fuelName}
          now={now}
          onClose={closeHistory}
        />
      )}
      <div className={styles.underHistory} hidden={search.history !== null}>
        <FavouritesPanel fuel={fuel} fuelName={fuelName} now={now} openByDefault={place === null} />
        <Results
          view={view}
          fuelName={fuelName}
          radius={radius}
          maxRadius={MAX_RADIUS_KM}
          now={now}
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
          onChooseDistance={() => {
            radiusSelect.current?.focus();
          }}
          onSearchInstead={() => {
            geolocation.reset();
            focusSearch();
          }}
          searchKey={searchKey}
          refreshed={refreshed}
          station={search.station}
          layout={search.view}
          onSelectStation={selectStation}
          onLayoutChange={setView}
        />
      </div>
    </HistoryLinkContext>
  );
}
