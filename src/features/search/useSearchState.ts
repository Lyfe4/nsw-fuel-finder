import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  parseSearch,
  roundPosition,
  serializeSearch,
  type ResultsLayout,
  type ResultsSort,
  type SearchState,
} from './searchState';

import type { FuelTypeCode } from '../../../shared/fuelTypes';

/** Fired after our own pushState/replaceState, which do not fire popstate. */
const URL_CHANGED = 'fuelfinder:urlchange';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(URL_CHANGED, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(URL_CHANGED, onChange);
  };
}

const readSearch = () => window.location.search;

/**
 * pushState for a new place - Back returns to the previous search - and
 * replaceState for adjusting the current one (fuel, radius), so Back is not
 * a walk through every fuel the user tried.
 */
export function urlFor(next: SearchState): string {
  const query = serializeSearch(next);
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

/** Marks a history entry this page pushed to open a station's price history. */
const OPENED_HISTORY = 'fuelfinder:history';

function navigate(next: SearchState, mode: 'push' | 'replace', marker: string | null = null): void {
  const url = urlFor(next);
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (mode === 'push') window.history.pushState(marker, '', url);
  else window.history.replaceState(null, '', url);
  window.dispatchEvent(new Event(URL_CHANGED));
}

/**
 * The search, held in the URL. No router: one screen whose whole state is
 * its search does not need one (see docs/decisions.md).
 */
export function useSearchState() {
  const search = useSyncExternalStore(subscribe, readSearch, () => '');
  const state = useMemo(() => parseSearch(search), [search]);

  // Each action reads the URL as it is now, not as it was at the last render,
  // so two actions in one event cannot overwrite each other.
  const current = () => parseSearch(window.location.search);

  const setFuel = useCallback((fuel: FuelTypeCode) => {
    navigate({ ...current(), fuel }, 'replace');
  }, []);

  const setRadius = useCallback((radius: number) => {
    navigate({ ...current(), radius }, 'replace');
  }, []);

  // A new place starts with nothing selected: the old station is rarely in
  // the new results, and when it is, keeping it would be a surprise.
  const searchLocation = useCallback((query: string) => {
    const trimmed = query.trim().replace(/\s+/g, ' ');
    if (trimmed) {
      navigate(
        { ...current(), place: { kind: 'location', query: trimmed }, station: null, history: null },
        'push',
      );
    }
  }, []);

  const searchNearby = useCallback((lat: number, lng: number) => {
    navigate(
      {
        ...current(),
        place: { kind: 'nearby', ...roundPosition(lat, lng) },
        station: null,
        history: null,
      },
      'push',
    );
  }, []);

  // Sort and filters adjust the results on screen, like the fuel: replaced.
  const setSort = useCallback((sort: ResultsSort) => {
    navigate({ ...current(), sort }, 'replace');
  }, []);

  const setBrands = useCallback((brands: string[]) => {
    navigate({ ...current(), brands }, 'replace');
  }, []);

  const setHideOld = useCallback((hideOld: boolean) => {
    navigate({ ...current(), hideOld }, 'replace');
  }, []);

  const clearFilters = useCallback(() => {
    navigate({ ...current(), brands: [], hideOld: false }, 'replace');
  }, []);

  // Replace, not push: Back undoes a search, not every station looked at or
  // every flip between list and map (see docs/decisions.md).
  const setView = useCallback((view: ResultsLayout) => {
    navigate({ ...current(), view }, 'replace');
  }, []);

  const selectStation = useCallback((station: string | null, view?: ResultsLayout) => {
    const now = current();
    navigate({ ...now, station, view: view ?? now.view }, 'replace');
  }, []);

  /*
   * A station's price history is a view of its own: push, so Back closes it.
   * Closing it from its own button goes Back too when this page opened it,
   * so the history stack does not grow a second copy of the results; opened
   * from a shared link, there is nothing to go back to, so it is replaced.
   */
  const openHistory = useCallback((code: string) => {
    navigate({ ...current(), history: code }, 'push', OPENED_HISTORY);
  }, []);

  const closeHistory = useCallback(() => {
    if (window.history.state === OPENED_HISTORY) window.history.back();
    else navigate({ ...current(), history: null }, 'replace');
  }, []);

  /** The link to a station's history from the current search, for an <a href>. */
  const historyHref = useCallback((code: string) => urlFor({ ...current(), history: code }), []);

  return {
    ...state,
    openHistory,
    closeHistory,
    historyHref,
    setFuel,
    setRadius,
    setSort,
    setBrands,
    setHideOld,
    clearFilters,
    searchLocation,
    searchNearby,
    setView,
    selectStation,
  };
}
