import { skipToken, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { fetchStations } from '@/lib/api';

import {
  getFavourites,
  removeFavourite,
  subscribeFavourites,
  toggleFavourite,
  type Favourite,
} from './favourites';

const NONE: Favourite[] = [];

export function useFavourites() {
  const favourites = useSyncExternalStore(subscribeFavourites, getFavourites, () => NONE);
  return { favourites, toggleFavourite, removeFavourite };
}

/**
 * Today's prices for the favourites, from /api/stations: the snapshot the
 * API already holds, looked up by code, so no API.NSW call and no new
 * search. Every fuel comes back at once, so changing fuel needs no refetch.
 */
export function useFavouritePrices(favourites: readonly Favourite[]) {
  const codes = favourites.map((favourite) => favourite.code).sort((a, b) => a.localeCompare(b));
  return useQuery({
    queryKey: ['stations', codes],
    queryFn: codes.length > 0 ? ({ signal }) => fetchStations(codes, signal) : skipToken,
  });
}
