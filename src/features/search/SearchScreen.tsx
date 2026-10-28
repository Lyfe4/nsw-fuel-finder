import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FavouritesPanel } from '@/features/favourites/FavouritesPanel';
import { HistoryLinkContext, HistoryLinkHint } from '@/features/history/HistoryLink';
import { LazyHistoryView } from '@/features/history/LazyHistoryView';
import { applyFilters, hasFilters, sortStations } from '@/features/prices/filters';
import { refineNearby, refineNearest } from '@/features/prices/refine';
import { Results } from '@/features/prices/Results';
import { usePrices } from '@/features/prices/usePrices';
import { useRefreshed } from '@/features/prices/useRefreshed';
import { resultsView } from '@/features/prices/view';
import { useMediaQuery, WIDE_SCREEN } from '@/lib/useMediaQuery';

import { SearchForm } from './SearchForm';
import styles from './SearchScreen.module.css';
import { roundPosition } from './searchState';
import { useGeolocation } from './useGeolocation';
import { useSearchState } from './useSearchState';
import { NEAREST_COUNT } from '../../../shared/api';
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
  const { setSort, setBrands, setHideOld, clearFilters } = search;
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
  const searchKey = JSON.stringify(priceSearch);
  const refreshed = useRefreshed(searchKey, prices.data?.fetchedAt);

  // With the precise position for this very search, show real distances.
  const { stations, nearest } = useMemo(() => {
    const data = prices.data;
    if (!data) return { stations: [], nearest: [] };
    const precise = geolocation.position;
    const asSent = { stations: data.stations, nearest: data.nearest };
    if (place?.kind !== 'nearby' || !precise) return asSent;
    const rounded = roundPosition(precise.latitude, precise.longitude);
    if (rounded.lat !== place.lat || rounded.lng !== place.lng) return asSent;
    const refined = refineNearby(data.stations, precise, radius);
    if (refined.length > 0) return { stations: refined, nearest: [] };
    // The API searched a little past the radius (it only has the rounded
    // position). If all it found is really just outside, those are the
    // nearest; otherwise its own nearest list, measured again.
    const beyond = data.stations.length > 0 ? data.stations : data.nearest;
    return { stations: [], nearest: refineNearest(beyond, precise).slice(0, NEAREST_COUNT) };
  }, [prices.data, geolocation.position, place, radius]);

  /*
   * "Now", to the minute: the list's "updated 3 hours ago" and the old-price
   * filter must agree on which prices are old, and a new Date on every render
   * would refilter (and redraw the map) for nothing.
   */
  const minute = Math.floor(new Date().getTime() / 60_000);
  const now = useMemo(() => new Date(minute * 60_000), [minute]);

  const { sort, brands, hideOld } = search;
  const filters = useMemo(() => ({ brands, hideOld }), [brands, hideOld]);
  const shown = useMemo(
    () => sortStations(applyFilters(stations, filters, now), sort),
    [stations, filters, now, sort],
  );

  const view = resultsView({
    geolocation: geolocation.status,
    hasSearch: place !== null,
    pending: prices.isPending,
    error: prices.error,
    data: prices.data,
    stations,
    shown,
    filtered: hasFilters(filters),
    nearest,
  });

  const fuelName = FUEL_TYPES.find((f) => f.code === fuel)?.name ?? fuel;

  /*
   * THE FOLDED FORM (phones). After a search the form folds into one line
   * (SearchForm), and Change opens it again. A search made from the open
   * form folds it only once it has worked: then focus, which was in the
   * form, goes to the results heading. If it fails (no such place, location
   * blocked) the form stays open with focus in the place field, so a typo
   * can be fixed where it was made.
   */
  const wide = useMediaQuery(WIDE_SCREEN);
  const [searchOpen, setSearchOpen] = useState(false);
  const foldable = !wide && place !== null;
  const [searching, setSearching] = useState(false);
  // A new object each time, so the same target can be asked for twice.
  const [focusRequest, setFocusRequest] = useState<{ target: 'heading' | 'place' } | null>(null);
  const startSearch = () => {
    if (wide) return;
    setSearching(true);
    setSearchOpen(true);
  };
  const settled = view.kind !== 'loading' && view.kind !== 'locating' && view.kind !== 'idle';
  const failed = view.kind === 'error' || view.kind === 'location-problem';
  // Adjusted while rendering, as React recommends for state that follows
  // other state, rather than in an effect that would render twice.
  if (searching && settled) {
    setSearching(false);
    if (!failed) setSearchOpen(false);
    setFocusRequest({ target: failed ? 'place' : 'heading' });
  }
  useLayoutEffect(() => {
    if (!focusRequest) return;
    (focusRequest.target === 'place' ? placeInput.current : resultsHeading.current)?.focus();
  }, [focusRequest]);

  /*
   * Buttons in the results area (Retry, Widen, a "did you mean" choice)
   * disappear when they work. Focus moves first, in the same click, so a
   * keyboard user is not dropped onto <body>. "Change the search" opens a
   * folded form first; focus follows once it is on screen.
   */
  const focusResults = () => resultsHeading.current?.focus();
  const wantsSearchFocus = useRef(false);
  const focusSearch = () => {
    if (foldable && !searchOpen) {
      wantsSearchFocus.current = true;
      setSearchOpen(true);
    } else {
      placeInput.current?.focus();
    }
  };
  useLayoutEffect(() => {
    if (!wantsSearchFocus.current || !searchOpen) return;
    wantsSearchFocus.current = false;
    placeInput.current?.focus();
  }, [searchOpen]);

  /*
   * Closing a station's history (its button, or Back) hides the view that had
   * focus. Focus returns to the link that opened it; or, when that link is
   * not on screen (a shared link: the station's card is not open), to the
   * station's row; or, failing that, to the results heading.
   */
  const lastHistory = useRef(search.history);
  useLayoutEffect(() => {
    const closed = lastHistory.current;
    lastHistory.current = search.history;
    if (closed === null || search.history !== null) return;
    const onScreen = (element: HTMLElement) => !element.closest('[hidden], details:not([open])');
    const links = document.querySelectorAll<HTMLElement>(`[data-history-link="${closed}"]`);
    // Not one in a hidden view, or in the closed favourites panel, which
    // links to the same station but cannot take focus while closed.
    const visible = [...links].find(onScreen);
    const rows = document.querySelectorAll<HTMLElement>(`[data-station="${closed}"] h3 button`);
    const row = [...rows].find(onScreen);
    (visible ?? row ?? resultsHeading.current)?.focus();
  });

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
        currentQuery={place?.kind === 'location' ? place.query : ''}
        locating={geolocation.status === 'locating'}
        onFuelChange={setFuel}
        onSearchPlace={(query) => {
          startSearch();
          geolocation.reset();
          searchLocation(query);
        }}
        onUseLocation={() => {
          startSearch();
          geolocation.locate();
        }}
        placeInputRef={placeInput}
        folded={
          foldable
            ? {
                open: searchOpen,
                place: place.kind === 'location' ? place.query : 'near you',
                onOpenChange: setSearchOpen,
              }
            : null
        }
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
        <FavouritesPanel
          fuel={fuel}
          fuelName={fuelName}
          now={now}
          openByDefault={place === null}
          onEmptied={place === null ? focusSearch : focusResults}
        />
        <Results
          view={view}
          fuelName={fuelName}
          radius={radius}
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
          tools={{
            found: stations,
            sort,
            brands,
            hideOld,
            onSortChange: setSort,
            onBrandsChange: setBrands,
            onHideOldChange: setHideOld,
            onClearFilters: clearFilters,
          }}
          onClearFilters={() => {
            focusResults();
            clearFilters();
          }}
        />
      </div>
    </HistoryLinkContext>
  );
}
