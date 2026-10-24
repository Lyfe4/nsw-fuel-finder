import { priceAge } from './priceAge';

import type { StationPrice } from '../../../shared/api';
import type { ResultsSort } from '../search/searchState';

const collator = new Intl.Collator('en-AU', { sensitivity: 'base' });

export interface ResultsFilters {
  /** Only these brands; empty means every brand. */
  brands: readonly string[];
  hideOld: boolean;
}

export function hasFilters({ brands, hideOld }: ResultsFilters): boolean {
  return brands.length > 0 || hideOld;
}

/** Leaves out prices not updated for OLD_PRICE_DAYS, judged exactly as the list flags them. */
export function withoutOld(stations: readonly StationPrice[], now: Date): StationPrice[] {
  return stations.filter((station) => !priceAge(station.priceUpdatedAt, now).old);
}

export function applyFilters(
  stations: readonly StationPrice[],
  filters: ResultsFilters,
  now: Date,
): StationPrice[] {
  const recent = filters.hideOld ? withoutOld(stations, now) : [...stations];
  if (filters.brands.length === 0) return recent;
  const wanted = new Set(filters.brands);
  return recent.filter((station) => wanted.has(station.brand));
}

/**
 * The API sends stations cheapest first (then nearest, then by name), so
 * 'price' keeps that order. 'distance' is nearest first, then cheapest.
 */
export function sortStations(stations: StationPrice[], sort: ResultsSort): StationPrice[] {
  if (sort === 'price') return stations;
  return [...stations].sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      a.priceCents - b.priceCents ||
      collator.compare(a.name, b.name),
  );
}

/**
 * Each brand in the results and how many stations it has, most first. A
 * brand that is chosen but not in these results (kept from the last search)
 * is still listed, with 0, so it can be unticked.
 */
export function brandCounts(
  stations: readonly StationPrice[],
  chosen: readonly string[],
): { brand: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { brand } of stations) counts.set(brand, (counts.get(brand) ?? 0) + 1);
  for (const brand of chosen) if (!counts.has(brand)) counts.set(brand, 0);
  return [...counts]
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.brand, b.brand));
}

/** "all brands", "BP", "BP and Shell", "3 brands", plus ", recent prices only". */
export function filtersText({ brands, hideOld }: ResultsFilters): string {
  const brandText =
    brands.length === 0
      ? 'all brands'
      : brands.length <= 2
        ? [...brands].sort(collator.compare).join(' and ')
        : `${String(brands.length)} brands`;
  return hideOld ? `${brandText}, recent prices only` : brandText;
}
