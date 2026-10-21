import { parseUpstreamTimestamp } from './time';

import type { UpstreamPricesResponse, UpstreamReferenceResponse } from './schemas';
import type { PricesResponse, ReferenceResponse, StationPrice } from '../../../shared/api';

/**
 * v2 includes Tasmania. Rows without a `state` are kept: the location
 * endpoint reuses the v1 schema, which has no state field, and v1 is NSW only.
 */
const isNsw = (state: string | undefined): boolean => state === undefined || state === 'NSW';

const collator = new Intl.Collator('en-AU', { sensitivity: 'base' });

export function compareStations(a: StationPrice, b: StationPrice): number {
  return (
    a.priceCents - b.priceCents ||
    (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
    collator.compare(a.name, b.name)
  );
}

/**
 * Joins stations to their price for one fuel type. Upstream returns two
 * parallel arrays linked by station code; a station with no price for this
 * fuel, or a price whose station is missing, is dropped rather than shown
 * half-filled.
 */
export function normalisePrices(
  upstream: UpstreamPricesResponse,
  fuelType: string,
  options: { includeDistance: boolean },
): PricesResponse {
  const prices = new Map<string, { price: number; updatedAt: string }>();
  for (const row of upstream.prices) {
    if (row.fueltype !== fuelType || !isNsw(row.state)) continue;
    // A zero or negative price is a placeholder, never a real price.
    if (!(row.price > 0)) continue;
    const updatedAt = parseUpstreamTimestamp(row.lastupdated);
    if (updatedAt === null) continue;
    prices.set(row.stationcode, { price: row.price, updatedAt });
  }

  const stations: StationPrice[] = [];
  const seen = new Set<string>();
  for (const station of upstream.stations) {
    if (!isNsw(station.state) || seen.has(station.code)) continue;
    const price = prices.get(station.code);
    if (!price) continue;
    seen.add(station.code);
    stations.push({
      stationCode: station.code,
      name: station.name.trim(),
      brand: station.brand.trim(),
      address: station.address.trim(),
      latitude: station.location.latitude,
      longitude: station.location.longitude,
      distanceKm:
        options.includeDistance && station.location.distance !== undefined
          ? Math.round(station.location.distance * 100) / 100
          : null,
      priceCents: price.price,
      priceUpdatedAt: price.updatedAt,
    });
  }

  // Our own sort, so the order does not depend on how upstream interpreted
  // `sortby` (the spec example uses both "price" and "Price").
  stations.sort(compareStations);
  return { fuelType, stations };
}

export function normaliseReference(upstream: UpstreamReferenceResponse): ReferenceResponse {
  const fuelTypes = new Map<string, string>();
  for (const item of upstream.fueltypes.items) {
    if (isNsw(item.state) && !fuelTypes.has(item.code)) fuelTypes.set(item.code, item.name.trim());
  }

  const brands = new Set<string>();
  for (const item of upstream.brands.items) {
    if (isNsw(item.state)) brands.add(item.name.trim());
  }

  return {
    fuelTypes: [...fuelTypes].map(([code, name]) => ({ code, name })),
    brands: [...brands].sort(collator.compare),
  };
}
