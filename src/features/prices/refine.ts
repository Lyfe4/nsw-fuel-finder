import { haversineKm, roundTo, type LatLng } from '../../../shared/geo';

import type { StationPrice } from '../../../shared/api';

const collator = new Intl.Collator('en-AU', { sensitivity: 'base' });

/**
 * The API measured from a position rounded to ~1 km and searched a little
 * past the radius to make up for it. With the precise position in hand, put
 * the real distances back, drop what is really outside the radius, and
 * re-sort - the same order the API uses: cheapest, then nearest, then name.
 */
export function refineNearby(
  stations: readonly StationPrice[],
  precise: LatLng,
  radiusKm: number,
): StationPrice[] {
  return stations
    .map((station) => ({
      ...station,
      distanceKm: roundTo(haversineKm(precise, station), 2),
    }))
    .filter((station) => station.distanceKm <= radiusKm)
    .sort(
      (a, b) =>
        a.priceCents - b.priceCents ||
        a.distanceKm - b.distanceKm ||
        collator.compare(a.name, b.name),
    );
}
