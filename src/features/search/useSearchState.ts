import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  parseSearch,
  roundPosition,
  serializeSearch,
  type ResultsLayout,
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
function navigate(next: SearchState, mode: 'push' | 'replace'): void {
  const query = serializeSearch(next);
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (mode === 'push') window.history.pushState(null, '', url);
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
        { ...current(), place: { kind: 'location', query: trimmed }, station: null },
        'push',
      );
    }
  }, []);

  const searchNearby = useCallback((lat: number, lng: number) => {
    navigate(
      { ...current(), place: { kind: 'nearby', ...roundPosition(lat, lng) }, station: null },
      'push',
    );
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

  return {
    ...state,
    setFuel,
    setRadius,
    searchLocation,
    searchNearby,
    setView,
    selectStation,
  };
}
