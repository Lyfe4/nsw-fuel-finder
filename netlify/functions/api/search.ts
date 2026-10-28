import { NEAREST_COUNT, NEAREST_MAX_KM, type StationPrice } from '../../../shared/api';
import { haversineKm, roundTo, type LatLng } from '../../lib/geo';
import { mendAddressCase } from '../../lib/places/addressCase';

import type { Place } from './places';
import type { FuelTypeCode } from '../../../shared/fuelTypes';
import type { SnapshotStation } from '../../lib/snapshot/format';
import type { HistoryDay } from '../../lib/snapshot/history';

/**
 * Nearby positions are rounded to ~1 km before they reach us, so a station
 * 4.6 km from the user can be 5.3 km from the rounded point. Searching this
 * much further keeps it in; the client filters on its precise position.
 */
const ROUNDING_SLACK_KM = 0.8;

const collator = new Intl.Collator('en-AU', { sensitivity: 'base' });

export function compareStations(a: StationPrice, b: StationPrice): number {
  return (
    a.priceCents - b.priceCents || a.distanceKm - b.distanceKm || collator.compare(a.name, b.name)
  );
}

/** One fuel's prices yesterday, by station code: [low, high, last]. */
export type YesterdayPrices = NonNullable<HistoryDay['fuels'][FuelTypeCode]>;

function toStationPrice(
  station: SnapshotStation,
  fuel: FuelTypeCode,
  origin: LatLng,
  yesterday: YesterdayPrices | undefined,
): StationPrice | null {
  const price = station.prices[fuel];
  if (!price) return null;
  const position = { latitude: station.lat, longitude: station.lng };
  const last = yesterday?.[station.code]?.[2];
  return {
    stationCode: station.code,
    name: station.name,
    brand: station.brand,
    address: mendAddressCase(station.address),
    latitude: station.lat,
    longitude: station.lng,
    distanceKm: roundTo(haversineKm(origin, position), 2),
    priceCents: price[0],
    priceUpdatedAt: price[1],
    // Rounded: 231.9 - 229.9 is 2.0000000000000284 in floating point.
    changeCents: last === undefined ? null : roundTo(price[0] - last, 1),
  };
}

/** Stations selling `fuel` within `radiusKm` of a (rounded) position. */
export function searchNearby(
  stations: readonly SnapshotStation[],
  origin: LatLng,
  radiusKm: number,
  fuel: FuelTypeCode,
  yesterday?: YesterdayPrices,
): StationPrice[] {
  const results: StationPrice[] = [];
  for (const station of stations) {
    const result = toStationPrice(station, fuel, origin, yesterday);
    if (result && result.distanceKm <= radiusKm + ROUNDING_SLACK_KM) results.push(result);
  }
  return results.sort(compareStations);
}

/**
 * Stations selling `fuel` in a place, plus any within `radiusKm` of its
 * centre. The union matters for big rural places: a station in the postcode
 * but 30 km from its centre still belongs in "prices in 2880".
 */
export function searchPlace(
  stations: readonly SnapshotStation[],
  place: Place,
  radiusKm: number,
  fuel: FuelTypeCode,
  yesterday?: YesterdayPrices,
): StationPrice[] {
  const results: StationPrice[] = [];
  for (const station of stations) {
    const result = toStationPrice(station, fuel, place, yesterday);
    if (!result) continue;
    if (place.stationCodes.has(station.code) || result.distanceKm <= radiusKm) {
      results.push(result);
    }
  }
  return results.sort(compareStations);
}

/**
 * For a search that found nothing: the nearest stations selling `fuel`, at
 * any distance up to NEAREST_MAX_KM, nearest first. Beyond that (Lord Howe
 * Island is 580 km from the nearest) a list is no help to anyone.
 */
export function searchNearest(
  stations: readonly SnapshotStation[],
  origin: LatLng,
  fuel: FuelTypeCode,
  yesterday?: YesterdayPrices,
): StationPrice[] {
  const results: StationPrice[] = [];
  for (const station of stations) {
    const result = toStationPrice(station, fuel, origin, yesterday);
    if (result && result.distanceKm <= NEAREST_MAX_KM) results.push(result);
  }
  return results
    .sort((a, b) => a.distanceKm - b.distanceKm || compareStations(a, b))
    .slice(0, NEAREST_COUNT);
}
