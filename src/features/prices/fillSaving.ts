import type { StationPrice } from '../../../shared/api';

/**
 * The fill the saving is worked out for. Fixed, and said in the sentence:
 * 50 litres is a small-to-mid car's tank, and a tank-size control would be
 * one more field for a number that only scales the saving.
 */
export const FILL_LITRES = 50;

export interface PriceSummary {
  cheapest: number;
  /** The mean of the prices shown, in cents. */
  average: number;
  /** Dollars saved filling FILL_LITRES at the cheapest rather than at the average. */
  saving: number;
}

/**
 * The cheapest and average of the stations shown, and what the difference
 * is worth on a fill. Null with fewer than two stations, where there is
 * nothing to compare.
 */
export function priceSummary(stations: readonly StationPrice[]): PriceSummary | null {
  if (stations.length < 2) return null;
  const prices = stations.map((station) => station.priceCents);
  const cheapest = Math.min(...prices);
  const average = prices.reduce((sum, cents) => sum + cents, 0) / prices.length;
  return { cheapest, average, saving: ((average - cheapest) * FILL_LITRES) / 100 };
}

const dollars = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

/** "$6.20" */
export function formatDollars(amount: number): string {
  return dollars.format(amount);
}
