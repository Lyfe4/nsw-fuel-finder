import { cheapestPrice } from '@/features/prices/priceAge';
import { formatPrice } from '@/lib/format';

import { haversineKm } from '../../../shared/geo';

import type { PricesResponse, StationPrice } from '../../../shared/api';

/**
 * Turning results into what the map draws. Kept apart from StationMap so it
 * can be tested without MapLibre (which needs WebGL, and jsdom has none).
 */

/** Cheapest third, middle third, dearest third of these results. */
export type PriceBand = 'low' | 'mid' | 'high';

export interface StationProperties {
  code: string;
  /** "229.5", drawn beside the dot; "Cheapest 209.9" for the cheapest. */
  label: string;
  band: PriceBand;
  /** One of the cheapest (ties included): its tag is drawn in the accent. */
  cheapest: boolean;
  /** Lower draws its label first, so where labels collide the cheaper one is kept. */
  priority: number;
}

export interface StationFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: StationProperties;
  }[];
}

/**
 * Bands by rank within these results, not fixed prices: "cheap" in Broken
 * Hill and in Parramatta are different numbers, and what a driver wants to
 * see is which of the stations in front of them are the cheaper ones. Ties
 * share a band, so equal prices are never coloured differently.
 */
export function priceBands(prices: readonly number[]): (price: number) => PriceBand {
  const sorted = [...prices].sort((a, b) => a - b);
  // The price at the end of the first third (or two thirds) of stations. The
  // epsilon stops 6 * (2/3) = 4.000000000000001 from rounding up a place.
  const at = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction - 1e-9) - 1)] ?? 0;
  const lowMax = at(1 / 3);
  const midMax = at(2 / 3);
  return (price) => (price <= lowMax ? 'low' : price <= midMax ? 'mid' : 'high');
}

/**
 * GeoJSON is longitude first. The cheapest stations (ties included) say so in
 * words, so the colour is never the only way to find them. Not when every
 * price is the same (one station, say), where "cheapest" would mean nothing.
 */
export function toFeatures(stations: readonly StationPrice[]): StationFeatureCollection {
  const prices = stations.map((station) => station.priceCents);
  const band = priceBands(prices);
  const cheapest = cheapestPrice(prices);
  return {
    type: 'FeatureCollection',
    features: stations.map((station) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [station.longitude, station.latitude] },
      properties: {
        code: station.stationCode,
        label:
          station.priceCents === cheapest
            ? `Cheapest ${formatPrice(station.priceCents)}`
            : formatPrice(station.priceCents),
        band: band(station.priceCents),
        cheapest: station.priceCents === cheapest,
        priority: station.priceCents,
      },
    })),
  };
}

/** Nearer than this, a neighbour at the same price passes for the selected station's own tag. */
export const LOOKALIKE_KM = 0.25;

/**
 * Stations whose price would read as the selected station's, twice: the
 * same price, within LOOKALIKE_KM. FuelCheck lists some sites a street
 * apart, or twice (diesel and petrol sides of a highway stop), and two
 * "236.5" tags side by side looked like one station tagged twice (Cessnock,
 * October 2026). While one is selected, these neighbours' prices make way;
 * their dots stay, and the list has their prices.
 */
export function lookalikes(stations: readonly StationPrice[], selected: string | null): string[] {
  const chosen = stations.find((station) => station.stationCode === selected);
  if (!chosen) return [];
  return stations
    .filter(
      (station) =>
        station.stationCode !== chosen.stationCode &&
        station.priceCents === chosen.priceCents &&
        haversineKm(station, chosen) < LOOKALIKE_KM,
    )
    .map((station) => station.stationCode);
}

/** [[west, south], [east, north]] around every station and the search origin. */
export function boundsOf(
  stations: readonly StationPrice[],
  origin: PricesResponse['origin'],
): [[number, number], [number, number]] {
  let west = origin.longitude;
  let east = origin.longitude;
  let south = origin.latitude;
  let north = origin.latitude;
  for (const { longitude, latitude } of stations) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return [
    [west, south],
    [east, north],
  ];
}
