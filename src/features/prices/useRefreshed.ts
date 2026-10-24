import { useState } from 'react';

/**
 * Whether the results on screen were replaced by a newer snapshot for the
 * same search: TanStack Query refetches when someone comes back to the tab,
 * and the half-hourly snapshot may have moved on. True from then until the
 * search changes. A new search, or the first answer to one, is not a refresh.
 *
 * Worked out during render from the previous values (React's "storing
 * information from previous renders"), so the announcement it drives is in
 * the same render as the new prices.
 */
export function useRefreshed(searchKey: string, fetchedAt: string | undefined): boolean {
  const [seen, setSeen] = useState({ searchKey, fetchedAt, refreshed: false });

  if (seen.searchKey !== searchKey) {
    setSeen({ searchKey, fetchedAt, refreshed: false });
    return false;
  }
  if (seen.fetchedAt !== fetchedAt && fetchedAt !== undefined) {
    const refreshed = seen.fetchedAt !== undefined || seen.refreshed;
    setSeen({ searchKey, fetchedAt, refreshed });
    return refreshed;
  }
  return seen.refreshed;
}
